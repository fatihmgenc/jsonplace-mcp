import { normalizeFieldDefinitions } from "./fakerCompat.js";

export function normalizeFieldsWithWarnings(input) {
  const normalized = normalizeFieldDefinitions(input);

  return {
    fields: normalized.fields.filter((field) => field.propName && field.parentTypeSelectionName && field.typeSelectionName),
    warnings: normalized.warnings,
    errors: normalized.errors
  };
}

export function normalizeFields(input) {
  return normalizeFieldsWithWarnings(input).fields;
}

export function validateTemplateInput(payload) {
  const title = String(payload?.title || "").trim();
  const description = String(payload?.description || "").trim();
  const normalized = normalizeFieldsWithWarnings(payload?.fields);
  const fields = normalized.fields;

  if (title.length < 3 || title.length > 80) {
    return { ok: false, error: "Title must be 3-80 characters." };
  }

  if (description.length > 280) {
    return { ok: false, error: "Description must be 280 characters or less." };
  }

  if (normalized.errors.length) {
    return { ok: false, error: normalized.errors[0] };
  }

  if (fields.length < 1 || fields.length > 200) {
    return { ok: false, error: "Template must include 1-200 fields." };
  }

  const tooLongField = fields.find((field) => field.propName.length > 128);
  if (tooLongField) {
    return { ok: false, error: "Each property name path must be at most 128 characters." };
  }

  const invalidPathField = fields.find((field) => {
    const segments = field.propName.split(".").filter(Boolean);
    if (!segments.length || segments.length > 10) {
      return true;
    }
    return segments.some((segment) => segment.length > 64);
  });
  if (invalidPathField) {
    return { ok: false, error: "Each property path must contain 1-10 segments, each up to 64 characters." };
  }

  return {
    ok: true,
    value: {
      title,
      description,
      fields
    },
    warnings: normalized.warnings
  };
}
