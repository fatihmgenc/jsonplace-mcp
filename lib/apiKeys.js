import { randomBytes, createHash } from "crypto";

const COLLECTION = "api_keys";
const API_KEY_PREFIX = "jpak";

function normalizeUserId(userId) {
  return String(userId || "").trim();
}

function normalizeApiKey(apiKey) {
  return String(apiKey || "").trim();
}

function buildApiKeyValue() {
  return `${API_KEY_PREFIX}_${randomBytes(32).toString("hex")}`;
}

export function hashApiKey(apiKey) {
  return createHash("sha256").update(normalizeApiKey(apiKey)).digest("hex");
}

function buildApiKeyDetails(record) {
  if (!record) {
    return {
      apiKey: "",
      createdAt: null,
      rotatedAt: null,
      lastUsedAt: null
    };
  }

  return {
    apiKey: String(record.apiKey || ""),
    createdAt: record.createdAt || null,
    rotatedAt: record.rotatedAt || null,
    lastUsedAt: record.lastUsedAt || null
  };
}

export async function ensureApiKeyIndexes(db) {
  await Promise.all([
    db.collection(COLLECTION).createIndex({ userId: 1 }, { unique: true }),
    db.collection(COLLECTION).createIndex({ keyHash: 1 }, { unique: true })
  ]);
}

export async function getApiKeyRecordForUser(db, userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return null;
  }

  await ensureApiKeyIndexes(db);
  return db.collection(COLLECTION).findOne({ userId: normalizedUserId });
}

export async function getApiKeyDetailsForUser(db, userId) {
  const record = await getApiKeyRecordForUser(db, userId);
  return buildApiKeyDetails(record);
}

export async function createOrRotateApiKeyForUser(db, userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    throw new Error("User id is required.");
  }

  await ensureApiKeyIndexes(db);

  const now = new Date();
  const current = await db.collection(COLLECTION).findOne({ userId: normalizedUserId });
  const apiKey = buildApiKeyValue();
  const document = {
    userId: normalizedUserId,
    apiKey,
    keyHash: hashApiKey(apiKey),
    createdAt: current?.createdAt || now,
    rotatedAt: current ? now : null,
    lastUsedAt: current?.lastUsedAt || null
  };

  if (current?._id) {
    await db.collection(COLLECTION).updateOne(
      { _id: current._id },
      {
        $set: {
          apiKey: document.apiKey,
          keyHash: document.keyHash,
          rotatedAt: document.rotatedAt
        }
      }
    );
  } else {
    await db.collection(COLLECTION).insertOne(document);
  }

  return buildApiKeyDetails(document);
}

export async function getApiKeyMatch(db, apiKey) {
  const normalizedApiKey = normalizeApiKey(apiKey);
  if (!normalizedApiKey) {
    return null;
  }

  await ensureApiKeyIndexes(db);

  const record = await db.collection(COLLECTION).findOne({ keyHash: hashApiKey(normalizedApiKey) });
  if (!record) {
    return null;
  }

  const lastUsedAt = new Date();
  await db.collection(COLLECTION).updateOne(
    { _id: record._id },
    { $set: { lastUsedAt } }
  );

  return {
    userId: normalizeUserId(record.userId),
    apiKey: String(record.apiKey || ""),
    createdAt: record.createdAt || null,
    rotatedAt: record.rotatedAt || null,
    lastUsedAt
  };
}
