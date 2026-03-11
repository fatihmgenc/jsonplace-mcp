import { ObjectId } from "mongodb";
import { ensureUserPublicNamespace, getBearerToken } from "./auth.js";
import { getApiKeyMatch } from "./apiKeys.js";
import { checkRateLimit, extractIp } from "./rateLimit.js";

export const INVALID_API_KEY_MESSAGE =
  "Invalid JsonPlace API key. Remove the Authorization header to use public mode, or send a valid API key for saved templates and endpoint management.";
export const ANONYMOUS_RATE_LIMIT_MESSAGE = "Too many anonymous MCP requests. Try again later.";

export async function resolveMcpRequestContext(request, db) {
  const bearerToken = getBearerToken(request);
  if (!bearerToken) {
    return {
      ok: true,
      authMode: "anonymous",
      user: null
    };
  }

  const apiKeyMatch = await getApiKeyMatch(db, bearerToken);
  const userId = String(apiKeyMatch?.userId || "").trim();
  if (!ObjectId.isValid(userId)) {
    return {
      ok: false,
      status: 401,
      code: -32001,
      message: INVALID_API_KEY_MESSAGE
    };
  }

  const user = await db.collection("users").findOne(
    { _id: new ObjectId(userId) },
    { projection: { username: 1, publicNamespace: 1, publicNamespaceLower: 1 } }
  );
  if (!user) {
    return {
      ok: false,
      status: 401,
      code: -32001,
      message: INVALID_API_KEY_MESSAGE
    };
  }

  return {
    ok: true,
    authMode: "apiKey",
    user: await ensureUserPublicNamespace(db, user)
  };
}

export function checkAnonymousMcpRateLimit(request) {
  const ip = extractIp(request);
  return checkRateLimit(`mcp-anon:${ip}`);
}
