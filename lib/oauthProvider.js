import { randomBytes, randomUUID } from "crypto";
import {
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { getAuthUser } from "./auth.js";
import { createHttpError } from "./httpErrors.js";

const CLIENTS_COLLECTION = "oauth_clients";
const AUTH_REQUESTS_COLLECTION = "oauth_auth_requests";
const AUTH_CODES_COLLECTION = "oauth_auth_codes";
const ACCESS_TOKENS_COLLECTION = "oauth_access_tokens";
const REFRESH_TOKENS_COLLECTION = "oauth_refresh_tokens";

const AUTH_REQUEST_TTL_MS = 10 * 60 * 1000;
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const JSONPLACE_MCP_SCOPE = "jsonplace:mcp";
export const JSONPLACE_REFRESH_SCOPE = "offline_access";
export const JSONPLACE_SUPPORTED_SCOPES = [JSONPLACE_MCP_SCOPE, JSONPLACE_REFRESH_SCOPE];

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map((value) => String(value).trim()))];
}

function nowDate() {
  return new Date();
}

function encodeToken(prefix) {
  return `${prefix}_${randomBytes(32).toString("hex")}`;
}

function getExpiryDate(secondsFromNow) {
  return new Date(Date.now() + secondsFromNow * 1000);
}

function normalizeResource(resourceServerUrl, resource) {
  if (!resource) {
    return resourceServerUrl.href;
  }

  const resolved = resource instanceof URL ? resource.href : String(resource);
  if (resolved !== resourceServerUrl.href) {
    throw new InvalidTargetError(`Unsupported resource '${resolved}'.`);
  }

  return resolved;
}

function normalizeScopes(requestedScopes) {
  const requested = uniqueStrings(requestedScopes);
  if (!requested.length) {
    return [JSONPLACE_MCP_SCOPE];
  }

  const invalid = requested.find((scope) => !JSONPLACE_SUPPORTED_SCOPES.includes(scope));
  if (invalid) {
    throw new InvalidScopeError(`Unsupported scope '${invalid}'.`);
  }

  if (!requested.includes(JSONPLACE_MCP_SCOPE)) {
    requested.unshift(JSONPLACE_MCP_SCOPE);
  }

  return requested;
}

export async function ensureOAuthIndexes(db) {
  await Promise.all([
    db.collection(CLIENTS_COLLECTION).createIndex({ client_id: 1 }, { unique: true }),
    db.collection(AUTH_REQUESTS_COLLECTION).createIndex({ requestId: 1 }, { unique: true }),
    db.collection(AUTH_REQUESTS_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection(AUTH_CODES_COLLECTION).createIndex({ code: 1 }, { unique: true }),
    db.collection(AUTH_CODES_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection(ACCESS_TOKENS_COLLECTION).createIndex({ token: 1 }, { unique: true }),
    db.collection(ACCESS_TOKENS_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection(REFRESH_TOKENS_COLLECTION).createIndex({ token: 1 }, { unique: true }),
    db.collection(REFRESH_TOKENS_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  ]);
}

class MongoOAuthClientsStore {
  constructor(db) {
    this.db = db;
  }

  async getClient(clientId) {
    return this.db.collection(CLIENTS_COLLECTION).findOne({ client_id: clientId });
  }

  async registerClient(clientInfo) {
    await this.db.collection(CLIENTS_COLLECTION).insertOne({
      ...clientInfo,
      createdAt: nowDate()
    });

    return clientInfo;
  }
}

export class JsonPlaceOAuthProvider {
  constructor({ db, resourceServerUrl }) {
    this.db = db;
    this.resourceServerUrl = resourceServerUrl;
    this._clientsStore = new MongoOAuthClientsStore(db);
  }

  get clientsStore() {
    return this._clientsStore;
  }

  async authorize(client, params, res) {
    await ensureOAuthIndexes(this.db);

    const scopes = normalizeScopes(params.scopes);
    const resource = normalizeResource(this.resourceServerUrl, params.resource);
    const user = await getAuthUser(res.req, this.db);

    if (user) {
      const redirectUrl = await this.completeAuthorizationRequest(
        {
          clientId: client.client_id,
          redirectUri: params.redirectUri,
          state: params.state || "",
          scopes,
          codeChallenge: params.codeChallenge,
          resource
        },
        user
      );

      res.redirect(302, redirectUrl);
      return;
    }

    const requestId = randomUUID();
    await this.db.collection(AUTH_REQUESTS_COLLECTION).insertOne({
      requestId,
      clientId: client.client_id,
      clientName: client.client_name || client.client_id,
      redirectUri: params.redirectUri,
      state: params.state || "",
      scopes,
      codeChallenge: params.codeChallenge,
      resource,
      createdAt: nowDate(),
      expiresAt: new Date(Date.now() + AUTH_REQUEST_TTL_MS)
    });

    res.redirect(302, `/oauth/authorize/continue/${encodeURIComponent(requestId)}`);
  }

  async getAuthorizationRequest(requestId) {
    await ensureOAuthIndexes(this.db);
    return this.db.collection(AUTH_REQUESTS_COLLECTION).findOne({ requestId: String(requestId || "").trim() });
  }

  async completePendingAuthorization(requestId, user) {
    const pending = await this.getAuthorizationRequest(requestId);
    if (!pending) {
      throw createHttpError(404, "Authorization request expired or was not found.");
    }

    const redirectUrl = await this.completeAuthorizationRequest(
      {
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        state: pending.state || "",
        scopes: pending.scopes || [JSONPLACE_MCP_SCOPE],
        codeChallenge: pending.codeChallenge,
        resource: pending.resource
      },
      user
    );

    await this.db.collection(AUTH_REQUESTS_COLLECTION).deleteOne({ requestId: pending.requestId });
    return redirectUrl;
  }

  async completeAuthorizationRequest(pending, user) {
    const code = encodeToken("jpac");
    await this.db.collection(AUTH_CODES_COLLECTION).insertOne({
      code,
      clientId: pending.clientId,
      accountId: user.id,
      username: user.username,
      redirectUri: pending.redirectUri,
      scopes: pending.scopes,
      codeChallenge: pending.codeChallenge,
      resource: pending.resource,
      createdAt: nowDate(),
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS)
    });

    const target = new URL(pending.redirectUri);
    target.searchParams.set("code", code);
    if (pending.state) {
      target.searchParams.set("state", pending.state);
    }
    return target.toString();
  }

  async challengeForAuthorizationCode(client, authorizationCode) {
    const record = await this.db.collection(AUTH_CODES_COLLECTION).findOne({
      code: authorizationCode,
      clientId: client.client_id
    });

    if (!record) {
      throw new InvalidGrantError("Invalid authorization code.");
    }

    return record.codeChallenge;
  }

  async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri, resource) {
    const record = await this.db.collection(AUTH_CODES_COLLECTION).findOne({ code: authorizationCode });
    if (!record) {
      throw new InvalidGrantError("Invalid authorization code.");
    }

    if (record.clientId !== client.client_id) {
      throw new InvalidGrantError("Authorization code was not issued to this client.");
    }

    if (redirectUri && redirectUri !== record.redirectUri) {
      throw new InvalidGrantError("Authorization code redirect_uri mismatch.");
    }

    if (normalizeResource(this.resourceServerUrl, resource) !== record.resource) {
      throw new InvalidGrantError("Authorization code resource mismatch.");
    }

    await this.db.collection(AUTH_CODES_COLLECTION).deleteOne({ code: authorizationCode });
    return this.issueTokens({
      clientId: client.client_id,
      accountId: record.accountId,
      username: record.username,
      scopes: record.scopes,
      resource: record.resource
    });
  }

  async exchangeRefreshToken(client, refreshToken, scopes, resource) {
    const record = await this.db.collection(REFRESH_TOKENS_COLLECTION).findOne({ token: refreshToken });
    if (!record) {
      throw new InvalidGrantError("Invalid refresh token.");
    }

    if (record.clientId !== client.client_id) {
      throw new InvalidGrantError("Refresh token was not issued to this client.");
    }

    if (normalizeResource(this.resourceServerUrl, resource) !== record.resource) {
      throw new InvalidGrantError("Refresh token resource mismatch.");
    }

    const requestedScopes = uniqueStrings(scopes?.length ? scopes : record.scopes);
    const invalidScope = requestedScopes.find((scope) => !record.scopes.includes(scope));
    if (invalidScope) {
      throw new InvalidScopeError(`Scope '${invalidScope}' was not granted for this refresh token.`);
    }

    await this.db.collection(REFRESH_TOKENS_COLLECTION).deleteOne({ token: refreshToken });
    return this.issueTokens({
      clientId: client.client_id,
      accountId: record.accountId,
      username: record.username,
      scopes: requestedScopes.length ? requestedScopes : record.scopes,
      resource: record.resource
    });
  }

  async issueTokens({ clientId, accountId, username, scopes, resource }) {
    const normalizedScopes = normalizeScopes(scopes);
    const accessToken = encodeToken("jpat");
    const accessExpiresAt = getExpiryDate(ACCESS_TOKEN_TTL_SECONDS);

    await this.db.collection(ACCESS_TOKENS_COLLECTION).insertOne({
      token: accessToken,
      clientId,
      accountId,
      username,
      scopes: normalizedScopes,
      resource,
      createdAt: nowDate(),
      expiresAt: accessExpiresAt
    });

    const response = {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: normalizedScopes.join(" ")
    };

    if (normalizedScopes.includes(JSONPLACE_REFRESH_SCOPE)) {
      const refreshToken = encodeToken("jprt");
      const refreshExpiresAt = getExpiryDate(REFRESH_TOKEN_TTL_SECONDS);

      await this.db.collection(REFRESH_TOKENS_COLLECTION).insertOne({
        token: refreshToken,
        clientId,
        accountId,
        username,
        scopes: normalizedScopes,
        resource,
        createdAt: nowDate(),
        expiresAt: refreshExpiresAt
      });

      response.refresh_token = refreshToken;
    }

    return response;
  }

  async verifyAccessToken(token) {
    const record = await this.db.collection(ACCESS_TOKENS_COLLECTION).findOne({ token });
    if (!record) {
      throw new InvalidTokenError("Invalid access token.");
    }

    return {
      token: record.token,
      clientId: record.clientId,
      scopes: record.scopes || [],
      expiresAt: Math.floor(new Date(record.expiresAt).getTime() / 1000),
      resource: record.resource ? new URL(record.resource) : undefined,
      extra: {
        accountId: record.accountId,
        username: record.username
      }
    };
  }

  async revokeToken(client, request) {
    await Promise.all([
      this.db.collection(ACCESS_TOKENS_COLLECTION).deleteOne({ token: request.token, clientId: client.client_id }),
      this.db.collection(REFRESH_TOKENS_COLLECTION).deleteOne({ token: request.token, clientId: client.client_id })
    ]);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderAuthorizationContinuePage({ requestId, clientName, error = "", username = "" }) {
  const safeError = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const safeUsername = escapeHtml(username);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connect ${escapeHtml(clientName)} to JsonPlace</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: linear-gradient(180deg, #0f172a, #111827); color: #e5e7eb; margin: 0; min-height: 100vh; display: grid; place-items: center; }
      main { width: min(460px, calc(100vw - 32px)); background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(148, 163, 184, 0.24); border-radius: 18px; padding: 28px; box-shadow: 0 24px 80px rgba(15, 23, 42, 0.45); }
      h1 { margin: 0 0 8px; font-size: 1.5rem; }
      p { color: #cbd5e1; line-height: 1.55; }
      .error { color: #fca5a5; }
      form { display: grid; gap: 12px; margin-top: 18px; }
      input { width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(148, 163, 184, 0.32); background: rgba(15, 23, 42, 0.65); color: inherit; box-sizing: border-box; }
      button { border: 0; border-radius: 999px; padding: 12px 16px; font-weight: 600; cursor: pointer; }
      .primary { background: #f59e0b; color: #111827; }
      .secondary { background: transparent; color: #e5e7eb; border: 1px solid rgba(148, 163, 184, 0.32); }
      .actions { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
      small { color: #94a3b8; display: block; margin-top: 12px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Connect ${escapeHtml(clientName)}</h1>
      <p>Sign in or create an account to let this MCP client work with your JsonPlace templates and mock endpoints.</p>
      ${safeError}
      <form method="post" action="/oauth/authorize/continue/${encodeURIComponent(requestId)}">
        <input type="hidden" name="mode" value="login" />
        <input name="username" placeholder="Username" value="${safeUsername}" required minlength="4" maxlength="32" />
        <input name="password" type="password" placeholder="Password" required minlength="6" maxlength="128" />
        <div class="actions">
          <button class="primary" type="submit">Login</button>
          <button class="secondary" type="submit" onclick="this.form.mode.value='register'">Create Account</button>
        </div>
      </form>
      <small>JsonPlace will remember this browser session, so reconnecting future MCP clients is faster.</small>
    </main>
  </body>
</html>`;
}
