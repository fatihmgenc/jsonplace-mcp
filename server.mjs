import express from "express";
import { ObjectId } from "mongodb";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import {
  JSONPLACE_MCP_SCOPE,
  JSONPLACE_SUPPORTED_SCOPES,
  JsonPlaceOAuthProvider,
  ensureOAuthIndexes,
  renderAuthorizationContinuePage
} from "./lib/oauthProvider.js";
import { createJsonPlaceMcpServer } from "./lib/mcpServer.js";
import { getDb } from "./lib/mongodb.js";
import {
  buildSessionCookie,
  buildPublicNamespaceFromUserId,
  createSession,
  ensureUserPublicNamespace,
  ensureAuthIndexes,
  getAuthUser,
  hashPassword,
  validateCredentialsInput,
  verifyPassword
} from "./lib/auth.js";
import { checkRateLimit, extractIp } from "./lib/rateLimit.js";
import { getSiteUrl } from "./lib/site.js";

const port = Number.parseInt(process.env.PORT || "3002", 10);

function getBaseUrl() {
  return new URL(getSiteUrl());
}

function getMcpUrl() {
  return new URL("/mcp", `${getSiteUrl()}/`);
}

function getAuthRedirectErrorHtml(message) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>JsonPlace Authorization</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; min-height: 100vh; display: grid; place-items: center; }
      main { width: min(420px, calc(100vw - 32px)); border: 1px solid rgba(148, 163, 184, 0.24); border-radius: 16px; padding: 24px; background: rgba(15, 23, 42, 0.92); }
      p { color: #cbd5e1; line-height: 1.55; }
    </style>
  </head>
  <body>
    <main>
      <h1>Authorization Error</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
}

async function resolveInteractiveUser(db, mode, username, password) {
  const validation = validateCredentialsInput({ username, password });
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  await ensureAuthIndexes(db);
  const { username: normalizedUsername, usernameLower, password: normalizedPassword } = validation.value;
  const users = db.collection("users");

  if (mode === "register") {
    const exists = await users.findOne({ usernameLower }, { projection: { _id: 1 } });
    if (exists) {
      throw new Error("Username already exists.");
    }

    const userId = new ObjectId();
    const publicNamespace = buildPublicNamespaceFromUserId(userId);
    const passwordHash = await hashPassword(normalizedPassword);
    const now = new Date();
    const result = await users.insertOne({
      _id: userId,
      username: normalizedUsername,
      usernameLower,
      publicNamespace,
      publicNamespaceLower: publicNamespace.toLowerCase(),
      passwordHash,
      createdAt: now
    });

    return {
      id: result.insertedId.toString(),
      username: normalizedUsername,
      publicNamespace
    };
  }

  const existing = await users.findOne({ usernameLower });
  if (!existing) {
    throw new Error("Invalid username or password.");
  }

  const validPassword = await verifyPassword(normalizedPassword, existing.passwordHash);
  if (!validPassword) {
    throw new Error("Invalid username or password.");
  }

  return ensureUserPublicNamespace(db, existing);
}

async function bootstrap() {
  const db = await getDb();
  await ensureOAuthIndexes(db);

  const siteUrl = getSiteUrl();
  const baseUrl = getBaseUrl();
  const mcpUrl = getMcpUrl();
  const oauthProvider = new JsonPlaceOAuthProvider({
    db,
    resourceServerUrl: mcpUrl
  });
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(mcpUrl);
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.get("/oauth/authorize/continue/:requestId", async (req, res) => {
    const authRequest = await oauthProvider.getAuthorizationRequest(req.params.requestId);
    if (!authRequest) {
      res.status(404).send(getAuthRedirectErrorHtml("This authorization request expired. Start the MCP connection again."));
      return;
    }

    const user = await getAuthUser(req, db);
    if (user) {
      const redirectUrl = await oauthProvider.completePendingAuthorization(authRequest.requestId, user);
      res.redirect(302, redirectUrl);
      return;
    }

    res.status(200).setHeader("Cache-Control", "no-store").send(
      renderAuthorizationContinuePage({
        requestId: authRequest.requestId,
        clientName: authRequest.clientName || authRequest.clientId
      })
    );
  });

  app.post("/oauth/authorize/continue/:requestId", express.urlencoded({ extended: false }), async (req, res) => {
    const authRequest = await oauthProvider.getAuthorizationRequest(req.params.requestId);
    if (!authRequest) {
      res.status(404).send(getAuthRedirectErrorHtml("This authorization request expired. Start the MCP connection again."));
      return;
    }

    const ip = extractIp(req);
    const rate = checkRateLimit(`oauth-continue:${ip}`);
    if (!rate.allowed) {
      res.status(429).send(
        renderAuthorizationContinuePage({
          requestId: authRequest.requestId,
          clientName: authRequest.clientName || authRequest.clientId,
          error: "Too many attempts. Try again shortly.",
          username: req.body?.username || ""
        })
      );
      return;
    }

    try {
      const mode = req.body?.mode === "register" ? "register" : "login";
      const user = await resolveInteractiveUser(db, mode, req.body?.username, req.body?.password);
      const session = await createSession(db, user.id);
      const redirectUrl = await oauthProvider.completePendingAuthorization(authRequest.requestId, user);

      res.setHeader("Set-Cookie", buildSessionCookie(session.token, session.expiresAt));
      res.redirect(302, redirectUrl);
    } catch (error) {
      res.status(400).send(
        renderAuthorizationContinuePage({
          requestId: authRequest.requestId,
          clientName: authRequest.clientName || authRequest.clientId,
          error: error.message || "Could not continue authorization.",
          username: req.body?.username || ""
        })
      );
    }
  });

  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: baseUrl,
      resourceServerUrl: mcpUrl,
      scopesSupported: JSONPLACE_SUPPORTED_SCOPES,
      serviceDocumentationUrl: new URL("/", `${siteUrl}/`),
      resourceName: "JsonPlace MCP"
    })
  );

  app.post(
    "/mcp",
    requireBearerAuth({
      verifier: oauthProvider,
      requiredScopes: [JSONPLACE_MCP_SCOPE],
      resourceMetadataUrl
    }),
    express.json({ limit: "1mb" }),
    async (req, res) => {
      const authInfo = req.auth;
      const accountId = String(authInfo?.extra?.accountId || "");
      const dbUser =
        ObjectId.isValid(accountId)
          ? await db.collection("users").findOne(
            { _id: new ObjectId(accountId) },
            { projection: { username: 1, publicNamespace: 1, publicNamespaceLower: 1 } }
          )
          : null;
      const user = await ensureUserPublicNamespace(
        db,
        dbUser || {
          id: accountId,
          username: String(authInfo?.extra?.username || "")
        }
      );

      const server = createJsonPlaceMcpServer({
        db,
        user,
        siteUrl
      });

      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);

        res.on("close", () => {
          transport.close();
          server.close();
        });
      } catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error"
            },
            id: null
          });
        }
      }
    }
  );

  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    });
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "jsonplace-mcp" });
  });

  app.listen(port, () => {
    console.log(`JsonPlace MCP listening on ${siteUrl} (port ${port})`);
  });
}

bootstrap().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
