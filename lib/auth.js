import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";
import { ObjectId } from "mongodb";
import { ensureApiKeyIndexes, getApiKeyMatch } from "./apiKeys.js";

const scrypt = promisify(_scrypt);
const SESSION_TTL_DAYS = 30;
export const SESSION_COOKIE_NAME = "jsonplace_session";

function normalizeUsername(username) {
  return String(username || "").trim();
}

function normalizePassword(password) {
  return String(password || "");
}

function normalizeUserId(value) {
  if (value instanceof ObjectId) {
    return value.toString();
  }

  const raw = String(value || "").trim();
  return ObjectId.isValid(raw) ? new ObjectId(raw).toString() : "";
}

export function buildPublicNamespaceFromUserId(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (normalizedUserId) {
    return `u-${normalizedUserId.toLowerCase()}`;
  }

  const fallback = createHash("sha256")
    .update(String(userId || "jsonplace-public-namespace"))
    .digest("hex")
    .slice(0, 24);
  return `u-${fallback}`;
}

export function generateAnonymousPublicNamespace() {
  return `anon-${randomBytes(12).toString("hex")}`;
}

export async function ensureUserPublicNamespace(db, user) {
  if (!user) {
    return null;
  }

  const id = normalizeUserId(user._id || user.id);
  const username = String(user.username || "").trim();
  const token = String(user.token || "").trim();
  const publicNamespace = String(user.publicNamespace || "").trim() || buildPublicNamespaceFromUserId(id);
  const publicNamespaceLower = publicNamespace.toLowerCase();

  if (db && id && (user.publicNamespace !== publicNamespace || user.publicNamespaceLower !== publicNamespaceLower)) {
    await db.collection("users").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          publicNamespace,
          publicNamespaceLower
        }
      }
    );
  }

  return {
    id,
    username,
    publicNamespace,
    publicNamespaceLower,
    token
  };
}

export async function findUserByPublicIdentifier(db, identifier) {
  const normalizedIdentifier = String(identifier || "").trim().toLowerCase();
  if (!normalizedIdentifier) {
    return null;
  }

  let user = null;
  let matchType = "";
  const objectIdMatch = normalizedIdentifier.match(/^u-([0-9a-f]{24})$/);
  if (objectIdMatch) {
    user = await db.collection("users").findOne(
      { _id: new ObjectId(objectIdMatch[1]) },
      { projection: { username: 1, publicNamespace: 1, publicNamespaceLower: 1 } }
    );
    if (user) {
      matchType = "publicNamespace";
    }
  }

  if (!user) {
    user = await db.collection("users").findOne(
      { publicNamespaceLower: normalizedIdentifier },
      {
        projection: {
          username: 1,
          publicNamespace: 1,
          publicNamespaceLower: 1
        }
      }
    );
    if (user) {
      matchType = "publicNamespace";
    }
  }

  if (!user) {
    user = await db.collection("users").findOne(
      { usernameLower: normalizedIdentifier },
      {
        projection: {
          username: 1,
          publicNamespace: 1,
          publicNamespaceLower: 1
        }
      }
    );
    if (user) {
      matchType = "username";
    }
  }

  const normalizedUser = await ensureUserPublicNamespace(db, user);
  return normalizedUser ? { ...normalizedUser, matchType } : null;
}

export function validateCredentialsInput(payload) {
  const username = normalizeUsername(payload?.username);
  const password = normalizePassword(payload?.password);

  if (username.length < 4 || username.length > 32) {
    return { ok: false, error: "Username must be 4-32 characters." };
  }

  if (password.length < 6 || password.length > 128) {
    return { ok: false, error: "Password must be 6-128 characters." };
  }

  return {
    ok: true,
    value: {
      username,
      usernameLower: username.toLowerCase(),
      password
    }
  };
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(derived).toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) {
    return false;
  }

  const [salt, savedHex] = stored.split(":");
  const derived = await scrypt(password, salt, 64);
  const current = Buffer.from(derived).toString("hex");

  const left = Buffer.from(current, "hex");
  const right = Buffer.from(savedHex, "hex");
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function readHeader(request, key) {
  if (!request) {
    return "";
  }

  if (typeof request.headers?.get === "function") {
    return request.headers.get(key) || "";
  }

  const raw = request.headers?.[key] ?? request.headers?.[key.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw[0] || "";
  }

  return typeof raw === "string" ? raw : "";
}

function parseCookieHeader(header) {
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) {
        return accumulator;
      }

      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      accumulator[name] = value;
      return accumulator;
    }, {});
}

export function getBearerToken(request) {
  const auth = readHeader(request, "authorization");
  if (!auth.startsWith("Bearer ")) {
    return "";
  }
  return auth.slice(7).trim();
}

export function getSessionTokenFromRequest(request) {
  const cookies = parseCookieHeader(readHeader(request, "cookie"));
  return cookies[SESSION_COOKIE_NAME] || "";
}

export function buildSessionCookie(token, expiresAt) {
  const expires = expiresAt instanceof Date ? expiresAt : new Date(Date.now() + SESSION_TTL_DAYS * 86400000);
  const maxAge = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Expires=${expires.toUTCString()}${secure}`;
}

export function buildClearedSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}

export function applySessionCookie(response, session) {
  response.headers.append("Set-Cookie", buildSessionCookie(session.token, session.expiresAt));
  return response;
}

export function clearSessionCookie(response) {
  response.headers.append("Set-Cookie", buildClearedSessionCookie());
  return response;
}

export async function ensureAuthIndexes(db) {
  await Promise.all([
    db.collection("users").createIndex({ usernameLower: 1 }, { unique: true }),
    db.collection("users").createIndex(
      { publicNamespaceLower: 1 },
      {
        unique: true,
        partialFilterExpression: {
          publicNamespaceLower: { $exists: true, $type: "string" }
        }
      }
    ),
    ensureApiKeyIndexes(db),
    db.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  ]);
}

export async function createSession(db, userId) {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.collection("sessions").insertOne({
    tokenHash: hashToken(token),
    userId,
    createdAt: now,
    expiresAt
  });

  return { token, expiresAt };
}

async function getUserBySessionToken(db, token) {
  if (!token) {
    return null;
  }

  const session = await db.collection("sessions").findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() }
  });

  if (!session) {
    return null;
  }

  const user = await db.collection("users").findOne(
    { _id: new ObjectId(session.userId) },
    { projection: { username: 1, publicNamespace: 1, publicNamespaceLower: 1 } }
  );
  if (!user) {
    return null;
  }

  const normalizedUser = await ensureUserPublicNamespace(db, user);
  return {
    ...normalizedUser,
    token
  };
}

export async function getSessionUser(request, db) {
  const token = getSessionTokenFromRequest(request);
  return getUserBySessionToken(db, token);
}

export async function getAuthUser(request, db) {
  const sessionUser = await getSessionUser(request, db);
  if (sessionUser) {
    return sessionUser;
  }

  const bearerToken = getBearerToken(request);
  if (!bearerToken) {
    return null;
  }

  const apiKeyMatch = await getApiKeyMatch(db, bearerToken);
  const userId = String(apiKeyMatch?.userId || "").trim();
  if (!ObjectId.isValid(userId)) {
    return null;
  }

  const user = await db.collection("users").findOne(
    { _id: new ObjectId(userId) },
    { projection: { username: 1, publicNamespace: 1, publicNamespaceLower: 1 } }
  );
  if (!user) {
    return null;
  }

  return ensureUserPublicNamespace(db, user);
}

export async function revokeSessionByToken(db, token) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return;
  }

  await db.collection("sessions").deleteOne({ tokenHash: hashToken(normalizedToken) });
}

export async function revokeSession(request, db) {
  const token = getSessionTokenFromRequest(request);
  if (!token) {
    return;
  }

  await revokeSessionByToken(db, token);
}
