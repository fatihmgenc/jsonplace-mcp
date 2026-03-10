import { FIELD_OPTIONS, fieldKeyToParts } from "./fakerCompat.js";

const FIRST_FIELD_KEY = FIELD_OPTIONS[0]?.items?.[0]?.key || "lorem.word";
const FIELD_OPTION_KEYS = new Set(FIELD_OPTIONS.flatMap((group) => group.items.map((item) => item.key)));
const DEFAULT_IMPORT_FIELD_KEY = FIELD_OPTION_KEYS.has("lorem.word") ? "lorem.word" : FIRST_FIELD_KEY;

export function normalizePropPath(value) {
  return String(value || "")
    .split(".")
    .map((segment) => String(segment || "").trim())
    .filter(Boolean)
    .join(".");
}

export function isValidPropPath(value) {
  const normalized = normalizePropPath(value);
  if (!normalized || normalized.length > 128) {
    return false;
  }

  const segments = normalized.split(".");
  if (!segments.length || segments.length > 10) {
    return false;
  }

  return segments.every((segment) => segment.length > 0 && segment.length <= 64);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function flattenJsonObjectEntries(source, parentPath = "") {
  if (!isPlainObject(source)) {
    return [];
  }

  const output = [];
  Object.entries(source).forEach(([rawKey, rawValue]) => {
    const segment = String(rawKey || "").trim();
    if (!segment) {
      return;
    }

    const path = normalizePropPath(parentPath ? `${parentPath}.${segment}` : segment);
    if (!path) {
      return;
    }

    if (isPlainObject(rawValue) && Object.keys(rawValue).length > 0) {
      output.push(...flattenJsonObjectEntries(rawValue, path));
      return;
    }

    output.push({ propName: path, sampleValue: rawValue });
  });

  return output;
}

function isLikelyUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isLikelyUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isLikelyIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}(T.+)?$/.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

export function inferFieldKeyFromSampleValue(sampleValue) {
  if (typeof sampleValue === "number") {
    return Number.isInteger(sampleValue) ? "random.number" : "random.float";
  }

  if (typeof sampleValue === "boolean") {
    return "random.boolean";
  }

  if (typeof sampleValue === "string") {
    const text = sampleValue.trim();
    if (!text) {
      return DEFAULT_IMPORT_FIELD_KEY;
    }

    if (isLikelyUuid(text)) {
      return "random.uuid";
    }

    if (isLikelyEmail(text)) {
      return "internet.email";
    }

    if (isLikelyUrl(text)) {
      return "internet.url";
    }

    if (isLikelyIsoDate(text)) {
      return "date.past";
    }

    const words = text.split(/\s+/).filter(Boolean).length;
    if (words >= 5 || text.length >= 42) {
      return "lorem.sentence";
    }

    if (words > 1 || text.length > 14) {
      return "lorem.words";
    }

    return "lorem.word";
  }

  return DEFAULT_IMPORT_FIELD_KEY;
}

export function buildFieldsFromJsonObject(parsed) {
  if (!isPlainObject(parsed)) {
    throw new Error("Paste a single JSON object (not an array).");
  }

  const flattened = flattenJsonObjectEntries(parsed);
  const byPath = new Map();

  flattened.forEach(({ propName, sampleValue }) => {
    const normalizedPath = normalizePropPath(propName);
    if (!isValidPropPath(normalizedPath)) {
      return;
    }

    const inferredKey = inferFieldKeyFromSampleValue(sampleValue);
    const fieldKey = FIELD_OPTION_KEYS.has(inferredKey) ? inferredKey : DEFAULT_IMPORT_FIELD_KEY;
    const { parentTypeSelectionName, typeSelectionName } = fieldKeyToParts(fieldKey);

    byPath.set(normalizedPath.toLowerCase(), {
      propName: normalizedPath,
      fieldKey,
      parentTypeSelectionName,
      typeSelectionName
    });
  });

  return [...byPath.values()];
}
