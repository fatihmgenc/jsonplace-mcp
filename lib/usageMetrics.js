const COLLECTION = "usage_counters";

let indexesReady = false;

export async function ensureUsageMetricIndexes(db) {
  if (indexesReady) {
    return;
  }

  await db.collection(COLLECTION).createIndex({ key: 1 }, { unique: true });
  indexesReady = true;
}

export async function incrementUsageMetric(db, key) {
  const normalizedKey = String(key || "").trim();
  if (!db || !normalizedKey) {
    return;
  }

  await ensureUsageMetricIndexes(db);

  const now = new Date();
  await db.collection(COLLECTION).updateOne(
    { key: normalizedKey },
    {
      $inc: { count: 1 },
      $set: { updatedAt: now },
      $setOnInsert: { createdAt: now }
    },
    { upsert: true }
  );
}
