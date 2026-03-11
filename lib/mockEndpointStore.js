import { ObjectId } from "mongodb";
import { findUserByPublicIdentifier, generateAnonymousPublicNamespace } from "./auth.js";
import {
  MOCK_OWNER_TYPES,
  buildMockPublicUrl,
  ensureMockEndpointIndexes,
  generateMockEndpointResponse,
  mockEndpointToClient,
  normalizeEndpointPath,
  validateMockEndpointInput
} from "./mockEndpoints.js";
import { createHttpError } from "./httpErrors.js";

const COLLECTION = "mock_endpoints";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampLimit(rawLimit) {
  const parsed = Number.parseInt(String(rawLimit || `${DEFAULT_LIMIT}`), 10);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(MAX_LIMIT, parsed))
    : DEFAULT_LIMIT;
}

function getId(rawId) {
  const id = String(rawId || "").trim();
  return ObjectId.isValid(id) ? id : "";
}

function endpointToClient(row, siteUrl, publicNamespace = "") {
  return mockEndpointToClient(row, siteUrl, publicNamespace);
}

function buildAccountOwnerDocument(user) {
  const ownerNamespace = String(user?.publicNamespace || "").trim();
  return {
    ownerType: MOCK_OWNER_TYPES.user,
    ownerNamespace,
    ownerNamespaceLower: ownerNamespace.toLowerCase(),
    userId: user.id,
    ownerUsername: user.username,
    ownerUsernameLower: user.username.toLowerCase()
  };
}

function buildAnonymousOwnerDocument() {
  const ownerNamespace = generateAnonymousPublicNamespace();
  return {
    ownerType: MOCK_OWNER_TYPES.anonymous,
    ownerNamespace,
    ownerNamespaceLower: ownerNamespace.toLowerCase(),
    userId: null,
    ownerUsername: "",
    ownerUsernameLower: ""
  };
}

function getStoredOwnerDocument(user) {
  return user?.id ? buildAccountOwnerDocument(user) : buildAnonymousOwnerDocument();
}

export async function listMockEndpointsForUser(db, user, siteUrl, limit = DEFAULT_LIMIT) {
  await ensureMockEndpointIndexes(db);

  const rows = await db
    .collection(COLLECTION)
    .find({ userId: user.id })
    .sort({ createdAt: -1 })
    .limit(clampLimit(limit))
    .toArray();

  return rows.map((row) => mockEndpointToClient(row, siteUrl, user.publicNamespace));
}

export async function createMockEndpointForUser(db, user, payload, siteUrl) {
  await ensureMockEndpointIndexes(db);

  const validation = validateMockEndpointInput(payload);
  if (!validation.ok) {
    throw createHttpError(400, validation.error);
  }

  const now = new Date();
  const owner = getStoredOwnerDocument(user);
  const document = {
    ...validation.value,
    ...owner,
    createdAt: now,
    updatedAt: now
  };

  try {
    const result = await db.collection(COLLECTION).insertOne(document);
    return endpointToClient(
      {
        _id: result.insertedId,
        ...document
      },
      siteUrl,
      owner.ownerNamespace
    );
  } catch (error) {
    if (error?.code === 11000) {
      throw createHttpError(409, user?.id
        ? "That endpoint path already exists for your account."
        : "That endpoint path already exists for this anonymous mock namespace.");
    }
    throw error;
  }
}

export async function updateMockEndpointForUser(db, user, endpointId, payload, siteUrl) {
  await ensureMockEndpointIndexes(db);

  const id = getId(endpointId);
  if (!id) {
    throw createHttpError(400, "Invalid endpoint id.");
  }

  const validation = validateMockEndpointInput(payload);
  if (!validation.ok) {
    throw createHttpError(400, validation.error);
  }

  const update = {
    ...validation.value,
    ownerType: MOCK_OWNER_TYPES.user,
    ownerNamespace: user.publicNamespace,
    ownerNamespaceLower: user.publicNamespace.toLowerCase(),
    ownerUsername: user.username,
    ownerUsernameLower: user.username.toLowerCase(),
    updatedAt: new Date()
  };

  try {
    const result = await db.collection(COLLECTION).findOneAndUpdate(
      { _id: new ObjectId(id), userId: user.id },
      { $set: update },
      { returnDocument: "after" }
    );

    if (!result) {
      throw createHttpError(404, "Mock endpoint not found.");
    }

    return mockEndpointToClient(result, siteUrl, user.publicNamespace);
  } catch (error) {
    if (error?.code === 11000) {
      throw createHttpError(409, "That endpoint path already exists for your account.");
    }
    throw error;
  }
}

export async function deleteMockEndpointForUser(db, user, endpointId) {
  await ensureMockEndpointIndexes(db);

  const id = getId(endpointId);
  if (!id) {
    throw createHttpError(400, "Invalid endpoint id.");
  }

  const result = await db.collection(COLLECTION).deleteOne({
    _id: new ObjectId(id),
    userId: user.id
  });

  if (!result.deletedCount) {
    throw createHttpError(404, "Mock endpoint not found.");
  }
}

export async function getPublicMockEndpoint(db, publicIdentifier, endpointPath) {
  await ensureMockEndpointIndexes(db);

  const normalizedPath = normalizeEndpointPath(endpointPath);
  const ownerIdentifier = String(publicIdentifier || "").trim().toLowerCase();
  if (!ownerIdentifier || !normalizedPath) {
    throw createHttpError(404, "Mock endpoint not found.");
  }

  const directEndpoint = await db.collection(COLLECTION).findOne(
    {
      ownerNamespaceLower: ownerIdentifier,
      endpointPathLower: normalizedPath.toLowerCase()
    },
    {
      projection: {
        sourceType: 1,
        fields: 1,
        responseJson: 1,
        ownerType: 1,
        ownerNamespace: 1,
        ownerUsername: 1,
        endpointPath: 1
      }
    }
  );

  if (directEndpoint) {
    return {
      endpointPath: directEndpoint.endpointPath,
      ownerUsername: directEndpoint.ownerUsername || "",
      ownerPublicNamespace: directEndpoint.ownerNamespace || ownerIdentifier,
      ownerMatchType: "publicNamespace",
      payload: generateMockEndpointResponse(directEndpoint)
    };
  }

  const owner = await findUserByPublicIdentifier(db, ownerIdentifier);
  if (!owner?.id) {
    throw createHttpError(404, "Mock endpoint not found.");
  }

  const endpoint = await db.collection(COLLECTION).findOne(
    {
      endpointPathLower: normalizedPath.toLowerCase(),
      $or: [
        { ownerNamespaceLower: owner.publicNamespaceLower },
        { userId: owner.id }
      ]
    },
    {
      projection: {
        sourceType: 1,
        fields: 1,
        responseJson: 1,
        ownerNamespace: 1,
        ownerUsername: 1,
        endpointPath: 1
      }
    }
  );

  if (!endpoint) {
    throw createHttpError(404, "Mock endpoint not found.");
  }

  return {
    endpointPath: endpoint.endpointPath,
    ownerUsername: endpoint.ownerUsername || owner.username,
    ownerPublicNamespace: endpoint.ownerNamespace || owner.publicNamespace,
    ownerMatchType: owner.matchType || "",
    payload: generateMockEndpointResponse(endpoint)
  };
}

export function buildPublicMockResponse(siteUrl, publicNamespace, endpointPath, payload) {
  return {
    publicUrl: buildMockPublicUrl(siteUrl, publicNamespace, endpointPath),
    payload
  };
}
