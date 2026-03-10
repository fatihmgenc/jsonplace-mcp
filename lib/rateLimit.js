const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 30;
const store = new Map();

function nowMs() {
  return Date.now();
}

function getRecord(ip) {
  const now = nowMs();
  const current = store.get(ip);

  if (!current || current.resetAt <= now) {
    const next = { count: 0, resetAt: now + WINDOW_MS };
    store.set(ip, next);
    return next;
  }

  return current;
}

export function checkRateLimit(ip) {
  const key = ip || "unknown";
  const record = getRecord(key);
  record.count += 1;

  return {
    allowed: record.count <= LIMIT,
    remaining: Math.max(0, LIMIT - record.count),
    resetAt: record.resetAt
  };
}

export function extractIp(request) {
  const readHeader = (key) => {
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
  };

  const fromForwarded = readHeader("x-forwarded-for");
  if (fromForwarded) {
    return fromForwarded.split(",")[0].trim();
  }

  const fromRealIp = readHeader("x-real-ip");
  if (fromRealIp) {
    return fromRealIp.trim();
  }

  return "unknown";
}
