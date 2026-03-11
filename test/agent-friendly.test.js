import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { buildPublicNamespaceFromUserId } from "../lib/auth.js";
import { createOrRotateApiKeyForUser, getApiKeyMatch } from "../lib/apiKeys.js";
import { normalizeFieldDefinitions } from "../lib/fakerCompat.js";
import { buildFieldsFromJsonObject } from "../lib/inference.js";
import { resolveMcpRequestContext } from "../lib/mcpAuth.js";
import { buildQuickstartPayload, buildUsageGuideMarkdown } from "../lib/mcpServer.js";
import { MOCK_SOURCE_TYPES, validateMockEndpointInput } from "../lib/mockEndpoints.js";
import { createMockEndpointForUser, getPublicMockEndpoint } from "../lib/mockEndpointStore.js";
import { getSiteUrl } from "../lib/site.js";

function compareValues(left, right) {
  const leftValue = left instanceof ObjectId ? left.toString() : left;
  const rightValue = right instanceof ObjectId ? right.toString() : right;
  return leftValue === rightValue;
}

function applyProjection(document, projection) {
  if (!projection) {
    return { ...document };
  }

  const output = { _id: document._id };
  Object.entries(projection).forEach(([key, value]) => {
    if (value && key in document) {
      output[key] = document[key];
    }
  });
  return output;
}

function matchesQuery(document, query) {
  if (query?.$or) {
    return query.$or.some((entry) => matchesQuery(document, entry));
  }

  return Object.entries(query || {}).every(([key, value]) => compareValues(document[key], value));
}

function createFakeDb({ users = [], mockEndpoints = [], apiKeys = [] }) {
  const state = {
    users: users.map((entry) => ({ ...entry })),
    mock_endpoints: mockEndpoints.map((entry) => ({ ...entry })),
    api_keys: apiKeys.map((entry) => ({ ...entry }))
  };

  return {
    state,
    collection(name) {
      const rows = state[name];
      return {
        async createIndex() {
          return `${name}_index`;
        },
        async findOne(query, options = {}) {
          const row = rows.find((entry) => matchesQuery(entry, query));
          return row ? applyProjection(row, options.projection) : null;
        },
        async updateOne(filter, update) {
          const row = rows.find((entry) => matchesQuery(entry, filter));
          if (!row) {
            return { matchedCount: 0, modifiedCount: 0 };
          }

          Object.assign(row, update?.$set || {});
          return { matchedCount: 1, modifiedCount: 1 };
        },
        async insertOne(document) {
          const insertedId = document._id || new ObjectId();
          rows.push({ _id: insertedId, ...document });
          return { insertedId };
        }
      };
    }
  };
}

test("normalizes legacy and compact field inputs to canonical Faker-style keys", () => {
  const normalized = normalizeFieldDefinitions([
    { propName: "company.name", fieldKey: "company.companyName" },
    { propName: "contact.city", parentTypeSelectionName: "address", typeSelectionName: "city" },
    { propName: "user.handle", key: "internet.userName" }
  ]);

  assert.equal(normalized.errors.length, 0);
  assert.deepEqual(
    normalized.fields.map((field) => field.fieldKey),
    ["company.name", "location.city", "internet.username"]
  );
  assert.equal(normalized.warnings.length, 3);
});

test("infers field keys with compact fieldKey output", () => {
  const fields = buildFieldsFromJsonObject({
    website: "https://jsonplace.com",
    active: true
  });

  assert.deepEqual(
    fields.map((field) => ({ propName: field.propName, fieldKey: field.fieldKey })),
    [
      { propName: "website", fieldKey: "internet.url" },
      { propName: "active", fieldKey: "random.boolean" }
    ]
  );
});

test("accepts forgiving sourceType aliases and object-form static JSON", () => {
  const validation = validateMockEndpointInput({
    title: "Service Health",
    endpointPath: "status/health",
    sourceType: "static_json",
    responseJson: {
      status: "ok"
    }
  });

  assert.equal(validation.ok, true);
  assert.equal(validation.value.sourceType, MOCK_SOURCE_TYPES.staticJson);
  assert.deepEqual(validation.value.responseJson, { status: "ok" });
  assert.match(validation.warnings[0], /Normalized sourceType/);
});

test("resolves public endpoints by canonical public namespace and backfills missing user namespace", async () => {
  const userId = "65f0c0ffee00000000000001";
  const endpointId = "65f0c0ffee00000000000002";
  const namespace = buildPublicNamespaceFromUserId(userId);
  const db = createFakeDb({
    users: [
      {
        _id: new ObjectId(userId),
        username: "fatih@example.com",
        usernameLower: "fatih@example.com"
      }
    ],
    mockEndpoints: [
      {
        _id: new ObjectId(endpointId),
        userId,
        ownerUsername: "fatih@example.com",
        endpointPath: "status/health",
        endpointPathLower: "status/health",
        sourceType: MOCK_SOURCE_TYPES.staticJson,
        responseJson: { status: "ok" }
      }
    ]
  });

  const endpoint = await getPublicMockEndpoint(db, namespace, "status/health");

  assert.equal(endpoint.ownerPublicNamespace, namespace);
  assert.deepEqual(endpoint.payload, { status: "ok" });
  assert.equal(db.state.users[0].publicNamespace, namespace);
});

test("createMockEndpointForUser returns owner namespace and public URL on create", async () => {
  const userId = "65f0c0ffee00000000000001";
  const publicNamespace = buildPublicNamespaceFromUserId(userId);
  const db = createFakeDb({});

  const endpoint = await createMockEndpointForUser(
    db,
    {
      id: userId,
      username: "fatih@example.com",
      publicNamespace
    },
    {
      title: "Health Check",
      endpointPath: "status/health",
      sourceType: MOCK_SOURCE_TYPES.staticJson,
      responseJson: { status: "ok" }
    },
    "https://jsonplace.com"
  );

  assert.equal(endpoint.ownerPublicNamespace, publicNamespace);
  assert.equal(endpoint.publicUrl, `https://jsonplace.com/mock/${publicNamespace}/status/health`);
});

test("anonymous mock endpoint creation returns a live public URL with an anonymous namespace", async () => {
  const db = createFakeDb({});

  const endpoint = await createMockEndpointForUser(
    db,
    null,
    {
      title: "Health Check",
      endpointPath: "status/health",
      sourceType: MOCK_SOURCE_TYPES.staticJson,
      responseJson: { status: "ok" }
    },
    "https://jsonplace.com"
  );

  assert.equal(endpoint.ownerType, "anonymous");
  assert.match(endpoint.ownerPublicNamespace, /^anon-[0-9a-f]{24}$/);
  assert.equal(endpoint.publicUrl, `https://jsonplace.com/mock/${endpoint.ownerPublicNamespace}/status/health`);

  const resolved = await getPublicMockEndpoint(db, endpoint.ownerPublicNamespace, "status/health");
  assert.equal(resolved.ownerPublicNamespace, endpoint.ownerPublicNamespace);
  assert.deepEqual(resolved.payload, { status: "ok" });
});

test("creates and rotates standalone MCP API keys with hash-based lookup", async () => {
  const userId = "65f0c0ffee00000000000001";
  const db = createFakeDb({});

  const firstKey = await createOrRotateApiKeyForUser(db, userId);
  assert.match(firstKey.apiKey, /^jpak_[0-9a-f]{64}$/);
  assert.equal(firstKey.rotatedAt, null);

  const firstMatch = await getApiKeyMatch(db, firstKey.apiKey);
  assert.equal(firstMatch.userId, userId);
  assert.ok(firstMatch.lastUsedAt instanceof Date);

  const rotatedKey = await createOrRotateApiKeyForUser(db, userId);
  assert.notEqual(rotatedKey.apiKey, firstKey.apiKey);
  assert.ok(rotatedKey.rotatedAt instanceof Date);

  const oldMatch = await getApiKeyMatch(db, firstKey.apiKey);
  assert.equal(oldMatch, null);
});

test("resolves MCP requests as anonymous without auth and authenticated with a valid API key", async () => {
  const userId = "65f0c0ffee00000000000001";
  const db = createFakeDb({
    users: [
      {
        _id: new ObjectId(userId),
        username: "fatih@example.com",
        usernameLower: "fatih@example.com"
      }
    ]
  });

  const anonymousContext = await resolveMcpRequestContext({ headers: {} }, db);
  assert.equal(anonymousContext.ok, true);
  assert.equal(anonymousContext.authMode, "anonymous");
  assert.equal(anonymousContext.user, null);

  const apiKey = await createOrRotateApiKeyForUser(db, userId);
  const authenticatedContext = await resolveMcpRequestContext(
    {
      headers: {
        authorization: `Bearer ${apiKey.apiKey}`
      }
    },
    db
  );

  assert.equal(authenticatedContext.ok, true);
  assert.equal(authenticatedContext.authMode, "apiKey");
  assert.equal(authenticatedContext.user.username, "fatih@example.com");

  const invalidContext = await resolveMcpRequestContext(
    {
      headers: {
        authorization: "Bearer jpak_invalid"
      }
    },
    db
  );

  assert.equal(invalidContext.ok, false);
  assert.equal(invalidContext.status, 401);
});

test("builds quickstart and usage guide content for the standalone MCP service", () => {
  const quickstart = buildQuickstartPayload("static");
  const guide = buildUsageGuideMarkdown("https://jsonplace.com");

  assert.equal(quickstart.topic, "static-endpoint");
  assert.equal(quickstart.recipes[0].tool, "jsonplace_create_static_endpoint");
  assert.match(guide, /jsonplace_create_template_endpoint/);
  assert.match(guide, /Connect without auth/);
  assert.match(guide, /Base site URL: https:\/\/jsonplace\.com/);
});

test("prefers JSONPLACE_SITE_URL for the standalone MCP service", () => {
  process.env.JSONPLACE_SITE_URL = "https://jsonplace.com";
  assert.equal(getSiteUrl(), "https://jsonplace.com");
  delete process.env.JSONPLACE_SITE_URL;
});
