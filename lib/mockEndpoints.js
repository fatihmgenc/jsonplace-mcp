import { generateObjectFromFields } from "./fakerCompat.js";
import { normalizeFields, normalizeFieldsWithWarnings } from "./templates.js";

export const MOCK_SOURCE_TYPES = {
  template: "template",
  staticJson: "staticJson"
};
export const MOCK_OWNER_TYPES = {
  user: "user",
  anonymous: "anonymous"
};
export const MOCK_SOURCE_OPTIONS = [
  { value: MOCK_SOURCE_TYPES.template, label: "Template Schema" },
  { value: MOCK_SOURCE_TYPES.staticJson, label: "Static JSON" }
];

const SOURCE_TYPE_LOOKUP = new Map([
  ["template", MOCK_SOURCE_TYPES.template],
  ["schema", MOCK_SOURCE_TYPES.template],
  ["staticjson", MOCK_SOURCE_TYPES.staticJson],
  ["static", MOCK_SOURCE_TYPES.staticJson],
  ["json", MOCK_SOURCE_TYPES.staticJson],
  ["static_json", MOCK_SOURCE_TYPES.staticJson]
]);

const TITLE_MIN_LENGTH = 3;
const TITLE_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 280;
const MAX_ENDPOINT_SEGMENTS = 12;
const MAX_ENDPOINT_SEGMENT_LENGTH = 64;
const MAX_ENDPOINT_PATH_LENGTH = 180;
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

let indexesReady = false;

function isJsonContainer(value) {
  return Boolean(value) && typeof value === "object";
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSourceTypeAlias(value) {
  return String(value || "")
    .trim()
    .replaceAll("-", "_")
    .toLowerCase();
}

export function normalizeSourceType(rawSourceType, fallbackType = MOCK_SOURCE_TYPES.template) {
  const original = String(rawSourceType || "").trim();
  if (!original) {
    return {
      ok: true,
      value: fallbackType,
      warnings: []
    };
  }

  const normalized = SOURCE_TYPE_LOOKUP.get(normalizeSourceTypeAlias(original));
  if (!normalized) {
    return {
      ok: false,
      error: `Unknown sourceType '${original}'. Use 'template' or 'staticJson'. Aliases accepted: schema, static, json, static_json.`
    };
  }

  const warnings = normalized !== original ? [`Normalized sourceType '${original}' to canonical value '${normalized}'.`] : [];
  return {
    ok: true,
    value: normalized,
    warnings
  };
}

export function normalizeEndpointPath(value) {
  return String(value || "")
    .split("/")
    .map((segment) => String(segment || "").trim())
    .filter(Boolean)
    .join("/");
}

export function isValidEndpointPath(value) {
  const normalized = normalizeEndpointPath(value);
  if (!normalized || normalized.length > MAX_ENDPOINT_PATH_LENGTH) {
    return false;
  }

  const segments = normalized.split("/");
  if (!segments.length || segments.length > MAX_ENDPOINT_SEGMENTS) {
    return false;
  }

  return segments.every((segment) =>
    segment.length > 0 &&
    segment.length <= MAX_ENDPOINT_SEGMENT_LENGTH &&
    ENDPOINT_SEGMENT_PATTERN.test(segment)
  );
}

export function parseStaticJsonInput(input) {
  if (typeof input === "string") {
    const source = input.trim();
    if (!source) {
      return { ok: false, error: "Static JSON is required." };
    }

    try {
      const parsed = JSON.parse(source);
      if (!isJsonContainer(parsed)) {
        return { ok: false, error: "Static JSON must be a JSON object or array." };
      }
      return { ok: true, value: parsed };
    } catch {
      return { ok: false, error: "Static JSON must be valid JSON." };
    }
  }

  if (!isJsonContainer(input)) {
    return { ok: false, error: "Static JSON must be a JSON object or array." };
  }

  return { ok: true, value: cloneJsonValue(input) };
}

export function validateMockEndpointInput(payload, options = {}) {
  const title = String(payload?.title || "").trim();
  const description = String(payload?.description || "").trim();
  const endpointPath = normalizeEndpointPath(payload?.endpointPath);
  const sourceTypeResult = normalizeSourceType(
    options?.forcedSourceType ?? payload?.sourceType,
    MOCK_SOURCE_TYPES.template
  );

  if (!sourceTypeResult.ok) {
    return { ok: false, error: sourceTypeResult.error };
  }

  const warnings = [...sourceTypeResult.warnings];
  const sourceType = sourceTypeResult.value;

  if (title.length < TITLE_MIN_LENGTH || title.length > TITLE_MAX_LENGTH) {
    return { ok: false, error: "Title must be 3-80 characters." };
  }

  if (description.length > DESCRIPTION_MAX_LENGTH) {
    return { ok: false, error: "Description must be 280 characters or less." };
  }

  if (!isValidEndpointPath(endpointPath)) {
    return {
      ok: false,
      error: "Endpoint path must contain 1-12 URL-safe segments using letters, numbers, dots, dashes, or underscores."
    };
  }

  if (sourceType === MOCK_SOURCE_TYPES.template) {
    const normalizedFields = normalizeFieldsWithWarnings(payload?.fields);
    if (normalizedFields.errors.length) {
      return { ok: false, error: normalizedFields.errors[0] };
    }

    const fields = normalizedFields.fields;
    warnings.push(...normalizedFields.warnings);

    if (fields.length < 1 || fields.length > 200) {
      return { ok: false, error: "Template-backed endpoints must include 1-200 fields." };
    }

    return {
      ok: true,
      value: {
        title,
        description,
        endpointPath,
        endpointPathLower: endpointPath.toLowerCase(),
        sourceType,
        fields,
        responseJson: null
      },
      warnings
    };
  }

  const staticJson = parseStaticJsonInput(payload?.responseJson);
  if (!staticJson.ok) {
    return { ok: false, error: staticJson.error };
  }

  return {
    ok: true,
    value: {
      title,
      description,
      endpointPath,
      endpointPathLower: endpointPath.toLowerCase(),
      sourceType,
      fields: [],
      responseJson: staticJson.value
    },
    warnings
  };
}

export function mockEndpointToClient(row, siteUrl = "", publicNamespace = "") {
  const ownerPublicNamespace = String(publicNamespace || row.ownerPublicNamespace || row.ownerNamespace || "").trim();

  return {
    id: row._id.toString(),
    title: row.title,
    description: row.description || "",
    endpointPath: row.endpointPath,
    sourceType: row.sourceType,
    fields: normalizeFields(Array.isArray(row.fields) ? row.fields : []),
    responseJson: row.responseJson ?? null,
    ownerType: row.ownerType || (row.userId ? MOCK_OWNER_TYPES.user : MOCK_OWNER_TYPES.anonymous),
    ownerUsername: row.ownerUsername || "",
    ownerPublicNamespace,
    publicUrl: buildMockPublicUrl(siteUrl, ownerPublicNamespace, row.endpointPath),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

export function buildMockPublicPath(publicNamespace, endpointPath) {
  const safeNamespace = encodeURIComponent(String(publicNamespace || "").trim());
  const normalizedPath = normalizeEndpointPath(endpointPath);
  if (!safeNamespace || !normalizedPath) {
    return "";
  }

  const encodedSegments = normalizedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment));

  return `/mock/${safeNamespace}/${encodedSegments.join("/")}`;
}

export function buildMockPublicUrl(siteUrl, publicNamespace, endpointPath) {
  const base = String(siteUrl || "").replace(/\/+$/, "");
  const path = buildMockPublicPath(publicNamespace, endpointPath);
  return base && path ? `${base}${path}` : path;
}

export function generateMockEndpointResponse(endpoint) {
  if (endpoint?.sourceType === MOCK_SOURCE_TYPES.staticJson) {
    return cloneJsonValue(endpoint.responseJson ?? {});
  }

  return generateObjectFromFields(endpoint?.fields || []);
}

export async function ensureMockEndpointIndexes(db) {
  if (indexesReady) {
    return;
  }

  const collection = db.collection("mock_endpoints");
  if (typeof collection.dropIndex === "function") {
    await Promise.all([
      collection.dropIndex("ownerUsernameLower_1_endpointPathLower_1").catch(() => null),
      collection.dropIndex("userId_1_endpointPathLower_1").catch(() => null)
    ]);
  }

  await Promise.all([
    collection.createIndex(
      { ownerNamespaceLower: 1, endpointPathLower: 1 },
      {
        unique: true,
        partialFilterExpression: {
          ownerNamespaceLower: { $exists: true, $type: "string" }
        }
      }
    ),
    collection.createIndex(
      { userId: 1, endpointPathLower: 1 },
      {
        unique: true,
        partialFilterExpression: {
          userId: { $exists: true, $type: "string" }
        }
      }
    ),
    collection.createIndex(
      { userId: 1, createdAt: -1 },
      {
        partialFilterExpression: {
          userId: { $exists: true, $type: "string" }
        }
      }
    )
  ]);
  indexesReady = true;
}
