import { faker } from "@faker-js/faker";

const FALLBACK_WORDS = ["alpha", "beta", "gamma", "delta", "omega", "json", "place", "template"];
const DYNAMIC_FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*$/;

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min = 0, max = 9999) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min = 0, max = 1000) {
  return Number((Math.random() * (max - min) + min).toFixed(2));
}

function safeCall(candidates, fallback) {
  for (const candidate of candidates) {
    try {
      const value = candidate();
      if (value !== undefined && value !== null) {
        return value;
      }
    } catch {
      // Continue to next candidate.
    }
  }

  return fallback();
}

function normalizeLookupKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDotPath(value) {
  return String(value || "")
    .split(".")
    .map((segment) => String(segment || "").trim())
    .filter(Boolean)
    .join(".");
}

function isDynamicFieldKey(value) {
  return DYNAMIC_FIELD_KEY_PATTERN.test(String(value || "").trim());
}

const FIELD_GROUPS = [
  {
    group: "Identity",
    items: [
      { key: "random.uuid", label: "UUID", aliases: [], tags: ["id", "uuid", "identifier"] },
      { key: "person.firstName", label: "First Name", aliases: ["name.firstName"], tags: ["name", "person", "identity"] },
      { key: "person.lastName", label: "Last Name", aliases: ["name.lastName"], tags: ["name", "person", "identity"] },
      { key: "internet.email", label: "Email", aliases: [], tags: ["email", "identity", "contact"] },
      { key: "internet.username", label: "Username", aliases: ["internet.userName"], tags: ["username", "handle", "identity"] }
    ]
  },
  {
    group: "Numbers & Dates",
    items: [
      { key: "random.number", label: "Random Number", aliases: [], tags: ["number", "integer"] },
      { key: "random.float", label: "Random Float", aliases: [], tags: ["number", "float", "decimal"] },
      { key: "random.boolean", label: "Boolean", aliases: [], tags: ["boolean", "true", "false"] },
      { key: "date.past", label: "Past Date", aliases: [], tags: ["date", "time", "history"] },
      { key: "date.future", label: "Future Date", aliases: [], tags: ["date", "time", "schedule"] }
    ]
  },
  {
    group: "Business",
    items: [
      { key: "company.name", label: "Company", aliases: ["company.companyName"], tags: ["company", "business", "organization"] },
      { key: "company.catchPhrase", label: "Catch Phrase", aliases: [], tags: ["company", "marketing", "business"] },
      { key: "company.buzzPhrase", label: "Buzz Phrase", aliases: [], tags: ["company", "marketing", "business"] },
      { key: "finance.currencyCode", label: "Currency Code", aliases: [], tags: ["finance", "currency", "money"] },
      { key: "commerce.price", label: "Price", aliases: [], tags: ["price", "money", "commerce"] },
      { key: "commerce.productName", label: "Product Name", aliases: [], tags: ["product", "commerce", "catalog"] }
    ]
  },
  {
    group: "Location & Web",
    items: [
      { key: "location.city", label: "City", aliases: ["address.city"], tags: ["city", "location", "address"] },
      { key: "location.country", label: "Country", aliases: ["address.country"], tags: ["country", "location", "address"] },
      {
        key: "location.streetAddress",
        label: "Street Address",
        aliases: ["address.streetAddress"],
        tags: ["street", "address", "location"]
      },
      { key: "phone.number", label: "Phone Number", aliases: [], tags: ["phone", "contact", "number"] },
      { key: "internet.url", label: "URL", aliases: [], tags: ["url", "website", "link", "web"] }
    ]
  },
  {
    group: "Text & Vehicle",
    items: [
      { key: "lorem.word", label: "Word", aliases: ["random.word"], tags: ["text", "word"] },
      { key: "lorem.words", label: "Words", aliases: ["random.words"], tags: ["text", "words"] },
      { key: "lorem.sentence", label: "Sentence", aliases: [], tags: ["text", "sentence"] },
      { key: "vehicle.manufacturer", label: "Manufacturer", aliases: [], tags: ["vehicle", "manufacturer", "transport"] },
      { key: "vehicle.model", label: "Model", aliases: [], tags: ["vehicle", "model", "transport"] }
    ]
  }
];

export const FIELD_OPTIONS = FIELD_GROUPS.map((group) => ({
  group: group.group,
  items: group.items.map((item) => ({
    key: item.key,
    label: item.label,
    aliases: [...item.aliases],
    tags: [...item.tags]
  }))
}));

const FIELD_OPTIONS_FLAT = FIELD_OPTIONS.flatMap((group) =>
  group.items.map((item) => ({
    ...item,
    group: group.group
  }))
);

const FIELD_OPTIONS_BY_KEY = new Map(FIELD_OPTIONS_FLAT.map((item) => [item.key, item]));
const FIELD_KEY_LOOKUP = new Map();

FIELD_OPTIONS_FLAT.forEach((item) => {
  FIELD_KEY_LOOKUP.set(normalizeLookupKey(item.key), item);
  item.aliases.forEach((alias) => {
    FIELD_KEY_LOOKUP.set(normalizeLookupKey(alias), item);
  });
});

function buildSearchScore(item, query) {
  const normalizedQuery = normalizeLookupKey(query);
  if (!normalizedQuery) {
    return 0;
  }

  const haystacks = [
    item.key,
    item.label,
    item.group,
    ...item.aliases,
    ...item.tags
  ].map(normalizeLookupKey);

  let score = 0;
  for (const haystack of haystacks) {
    if (!haystack) {
      continue;
    }

    if (haystack === normalizedQuery) {
      score += 12;
      continue;
    }

    if (haystack.startsWith(normalizedQuery)) {
      score += 8;
      continue;
    }

    if (haystack.includes(normalizedQuery)) {
      score += 4;
    }
  }

  return score;
}

export function serializeFieldOption(option) {
  if (!option) {
    return null;
  }

  return {
    key: option.key,
    label: option.label,
    group: option.group,
    aliases: [...option.aliases],
    tags: [...option.tags]
  };
}

export function getFieldCatalog() {
  return FIELD_OPTIONS.map((group) => ({
    group: group.group,
    items: group.items.map((item) => serializeFieldOption({ ...item, group: group.group }))
  }));
}

export function listFieldOptions({ group = "", limit = 100 } = {}) {
  const normalizedGroup = normalizeLookupKey(group);
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 100;

  return FIELD_OPTIONS_FLAT
    .filter((item) => !normalizedGroup || normalizeLookupKey(item.group) === normalizedGroup)
    .slice(0, normalizedLimit)
    .map(serializeFieldOption);
}

export function searchFieldOptions(query, { limit = 25 } = {}) {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 25;
  const normalizedQuery = normalizeLookupKey(query);
  if (!normalizedQuery) {
    return listFieldOptions({ limit: normalizedLimit });
  }

  return FIELD_OPTIONS_FLAT
    .map((item) => ({
      item,
      score: buildSearchScore(item, normalizedQuery)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.key.localeCompare(right.item.key))
    .slice(0, normalizedLimit)
    .map((entry) => serializeFieldOption(entry.item));
}

export function findFieldKeySuggestions(input, limit = 5) {
  const suggestions = searchFieldOptions(input, { limit: Math.max(limit, 5) }).map((item) => item.key);
  return [...new Set(suggestions)].slice(0, limit);
}

export function resolveFieldKey(rawFieldKey) {
  const original = String(rawFieldKey || "").trim();
  if (!original) {
    return { ok: false, error: "Field key is required. Use fieldKey like 'company.name' or split parent/type parts." };
  }

  const matchedOption = FIELD_KEY_LOOKUP.get(normalizeLookupKey(original));
  if (matchedOption) {
    const warnings = [];
    if (original !== matchedOption.key) {
      warnings.push(`Normalized field key '${original}' to canonical key '${matchedOption.key}'.`);
    }

    return {
      ok: true,
      key: matchedOption.key,
      option: matchedOption,
      warnings
    };
  }

  if (isDynamicFieldKey(original)) {
    return {
      ok: true,
      key: normalizeDotPath(original),
      option: null,
      warnings: []
    };
  }

  const suggestions = findFieldKeySuggestions(original);
  const suffix = suggestions.length ? ` Try ${suggestions.map((value) => `'${value}'`).join(", ")}.` : "";
  return {
    ok: false,
    error: `Unknown field key '${original}'. Use canonical Faker-style namespace.method keys.${suffix}`
  };
}

export function fieldKeyToParts(fieldKey) {
  const resolved = resolveFieldKey(fieldKey);
  const safeKey = resolved.ok ? resolved.key : normalizeDotPath(fieldKey);
  const [parentTypeSelectionName = "", typeSelectionName = ""] = safeKey.split(".");
  return { parentTypeSelectionName, typeSelectionName };
}

export function partsToFieldKey(field) {
  const rawFieldKey = String(field?.fieldKey || field?.key || "").trim();
  if (rawFieldKey) {
    const resolved = resolveFieldKey(rawFieldKey);
    return resolved.ok ? resolved.key : normalizeDotPath(rawFieldKey);
  }

  const composed = normalizeDotPath(`${field?.parentTypeSelectionName || ""}.${field?.typeSelectionName || ""}`);
  if (!composed) {
    return "";
  }

  const resolved = resolveFieldKey(composed);
  return resolved.ok ? resolved.key : composed;
}

export function normalizeFieldDefinition(field) {
  const propName = normalizeDotPath(field?.propName);
  const rawFieldKey = String(field?.fieldKey || field?.key || "").trim();
  const combinedFieldKey = rawFieldKey || normalizeDotPath(`${field?.parentTypeSelectionName || ""}.${field?.typeSelectionName || ""}`);

  if (!propName) {
    return { ok: false, error: "Each field must include a property path.", warnings: [] };
  }

  const resolved = resolveFieldKey(combinedFieldKey);
  if (!resolved.ok) {
    return {
      ok: false,
      error: `Field '${propName}' is invalid. ${resolved.error}`,
      warnings: []
    };
  }

  const { parentTypeSelectionName, typeSelectionName } = fieldKeyToParts(resolved.key);
  return {
    ok: true,
    value: {
      propName,
      fieldKey: resolved.key,
      parentTypeSelectionName,
      typeSelectionName
    },
    warnings: [...resolved.warnings]
  };
}

export function normalizeFieldDefinitions(input) {
  const fields = [];
  const warnings = [];
  const errors = [];

  if (!Array.isArray(input)) {
    return { fields, warnings, errors };
  }

  input.forEach((field) => {
    const normalized = normalizeFieldDefinition(field);
    if (!normalized.ok) {
      errors.push(normalized.error);
      return;
    }

    fields.push(normalized.value);
    warnings.push(...normalized.warnings);
  });

  return { fields, warnings, errors };
}

const GENERATORS = {
  "random.uuid": () =>
    safeCall(
      [() => faker.string.uuid()],
      () => globalThis.crypto?.randomUUID?.() || `uuid-${Date.now()}-${randomInt(1000, 9999)}`
    ),
  "random.number": () => safeCall([() => faker.number.int({ min: 0, max: 1000000 })], () => randomInt()),
  "random.float": () => safeCall([() => faker.number.float({ min: 0, max: 10000, fractionDigits: 2 })], () => randomFloat()),
  "random.boolean": () => safeCall([() => faker.datatype.boolean()], () => Math.random() > 0.5),
  "date.past": () =>
    safeCall([() => faker.date.past().toISOString()], () => new Date(Date.now() - randomInt(1, 30) * 86400000).toISOString()),
  "date.future": () =>
    safeCall([() => faker.date.future().toISOString()], () => new Date(Date.now() + randomInt(1, 30) * 86400000).toISOString()),
  "person.firstName": () => safeCall([() => faker.person.firstName()], () => "Avery"),
  "person.lastName": () => safeCall([() => faker.person.lastName()], () => "Morgan"),
  "company.name": () => safeCall([() => faker.company.name()], () => "JsonPlace Labs"),
  "company.catchPhrase": () => safeCall([() => faker.company.catchPhrase()], () => "Seamless payload orchestration"),
  "company.buzzPhrase": () => safeCall([() => faker.company.buzzPhrase()], () => "scale cloud-native synergy"),
  "internet.email": () => safeCall([() => faker.internet.email()], () => `user${randomInt(1, 9999)}@example.com`),
  "internet.username": () => safeCall([() => faker.internet.username()], () => `json_user_${randomInt(100, 999)}`),
  "internet.url": () => safeCall([() => faker.internet.url()], () => "https://example.com"),
  "lorem.word": () => safeCall([() => faker.lorem.word(), () => faker.word.sample()], () => pick(FALLBACK_WORDS)),
  "lorem.words": () => safeCall([() => faker.lorem.words(3), () => faker.word.words(3)], () => `${pick(FALLBACK_WORDS)} ${pick(FALLBACK_WORDS)}`),
  "lorem.sentence": () => safeCall([() => faker.lorem.sentence()], () => "Sample sentence for JsonPlace output."),
  "location.city": () => safeCall([() => faker.location.city()], () => "Berlin"),
  "location.country": () => safeCall([() => faker.location.country()], () => "Germany"),
  "location.streetAddress": () => safeCall([() => faker.location.streetAddress()], () => "42 Sample Street"),
  "phone.number": () => safeCall([() => faker.phone.number()], () => "+49 30 123456"),
  "finance.currencyCode": () => safeCall([() => faker.finance.currencyCode()], () => "USD"),
  "commerce.price": () => safeCall([() => faker.commerce.price({ min: 10, max: 1000 })], () => randomFloat(10, 1000).toString()),
  "commerce.productName": () => safeCall([() => faker.commerce.productName()], () => "Premium Plan"),
  "vehicle.manufacturer": () => safeCall([() => faker.vehicle.manufacturer()], () => "Contoso Motors"),
  "vehicle.model": () => safeCall([() => faker.vehicle.model()], () => "ZX-1")
};

function parsePropPath(propName) {
  return normalizeDotPath(propName)
    .split(".")
    .filter(Boolean);
}

function pathDepth(propName) {
  return parsePropPath(propName).length;
}

function setNestedValue(target, propName, value) {
  const segments = parsePropPath(propName);
  if (!segments.length) {
    return;
  }

  let current = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const existing = current[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      current[segment] = {};
    }
    current = current[segment];
  }

  current[segments[segments.length - 1]] = value;
}

export function generateValue(field) {
  const normalizedKey = partsToFieldKey(field);
  const generator = GENERATORS[normalizedKey];
  if (generator) {
    return generator();
  }

  const { parentTypeSelectionName, typeSelectionName } = fieldKeyToParts(normalizedKey);
  const category = faker[parentTypeSelectionName];
  const fallbackMethod = category?.[typeSelectionName];
  if (typeof fallbackMethod === "function") {
    try {
      return fallbackMethod.call(category);
    } catch {
      // Ignore dynamic call errors.
    }
  }

  return safeCall([() => faker.word.sample(), () => faker.lorem.word()], () => pick(FALLBACK_WORDS));
}

export function generateObjectFromFields(fields) {
  const output = {};
  const normalized = normalizeFieldDefinitions(fields).fields;

  normalized
    .filter((field) => String(field?.propName || "").trim())
    .slice()
    .sort((left, right) => pathDepth(left.propName) - pathDepth(right.propName))
    .forEach((field) => {
      setNestedValue(output, field.propName, generateValue(field));
    });

  return output;
}

export function generateSamplesFromFields(fields, sampleCount) {
  const count = Number.isFinite(sampleCount) && sampleCount > 0 ? Math.floor(sampleCount) : 1;
  if (count === 1) {
    return generateObjectFromFields(fields);
  }

  const output = [];
  for (let i = 0; i < count; i += 1) {
    output.push(generateObjectFromFields(fields));
  }
  return output;
}

export function getFieldOptionByKey(fieldKey) {
  const resolved = resolveFieldKey(fieldKey);
  return resolved.ok ? serializeFieldOption(resolved.option || FIELD_OPTIONS_BY_KEY.get(resolved.key)) : null;
}
