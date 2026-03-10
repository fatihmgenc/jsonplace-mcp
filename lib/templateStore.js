import { ObjectId } from "mongodb";
import { normalizeFields, validateTemplateInput } from "./templates.js";
import { createHttpError } from "./httpErrors.js";

const COLLECTION = "templates";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(rawLimit) {
  const parsed = Number.parseInt(String(rawLimit || `${DEFAULT_LIMIT}`), 10);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(MAX_LIMIT, parsed))
    : DEFAULT_LIMIT;
}

function templateToClient(row) {
  return {
    id: row._id.toString(),
    title: row.title,
    description: row.description || "",
    fields: normalizeFields(row.fields || []),
    createdAt: row.createdAt || null
  };
}

export async function listTemplatesForUser(db, user, limit = DEFAULT_LIMIT) {
  const rows = await db
    .collection(COLLECTION)
    .find({ userId: user.id }, { projection: { title: 1, description: 1, fields: 1, createdAt: 1 } })
    .sort({ createdAt: -1 })
    .limit(clampLimit(limit))
    .toArray();

  return rows.map(templateToClient);
}

export async function createTemplateForUser(db, user, payload) {
  const validation = validateTemplateInput(payload);
  if (!validation.ok) {
    throw createHttpError(400, validation.error);
  }

  const document = {
    ...validation.value,
    userId: user.id,
    createdAt: new Date()
  };

  const result = await db.collection(COLLECTION).insertOne(document);
  return templateToClient({
    _id: result.insertedId,
    ...document
  });
}

export async function deleteTemplateForUser(db, user, templateId) {
  const id = String(templateId || "").trim();
  if (!ObjectId.isValid(id)) {
    throw createHttpError(400, "Invalid template id.");
  }

  const result = await db.collection(COLLECTION).deleteOne({
    _id: new ObjectId(id),
    userId: user.id
  });

  if (!result.deletedCount) {
    throw createHttpError(404, "Template not found.");
  }
}
