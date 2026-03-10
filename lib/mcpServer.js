import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  generateSamplesFromFields,
  getFieldCatalog,
  listFieldOptions,
  normalizeFieldDefinitions,
  searchFieldOptions
} from "./fakerCompat.js";
import readyTemplates from "./readyTemplates.js";
import { buildFieldsFromJsonObject } from "./inference.js";
import {
  MOCK_SOURCE_TYPES,
  validateMockEndpointInput
} from "./mockEndpoints.js";
import {
  buildPublicMockResponse,
  createMockEndpointForUser,
  deleteMockEndpointForUser,
  getPublicMockEndpoint,
  listMockEndpointsForUser,
  updateMockEndpointForUser
} from "./mockEndpointStore.js";
import { createTemplateForUser, deleteTemplateForUser, listTemplatesForUser } from "./templateStore.js";
import { validateTemplateInput } from "./templates.js";
import { incrementUsageMetric } from "./usageMetrics.js";

const fieldSchema = z.object({
  propName: z.string(),
  fieldKey: z.string().optional(),
  key: z.string().optional(),
  parentTypeSelectionName: z.string().optional(),
  typeSelectionName: z.string().optional()
});

function uniqueWarnings(warnings) {
  return [...new Set((Array.isArray(warnings) ? warnings : []).filter(Boolean).map((value) => String(value).trim()))];
}

function withWarnings(structuredContent, warnings = []) {
  const normalizedWarnings = uniqueWarnings(warnings);
  if (!normalizedWarnings.length) {
    return structuredContent;
  }

  return {
    ...structuredContent,
    warnings: normalizedWarnings
  };
}

function jsonResult(structuredContent, textPayload = structuredContent, warnings = []) {
  return {
    content: [{ type: "text", text: JSON.stringify(withWarnings(textPayload, warnings), null, 2) }],
    structuredContent: withWarnings(structuredContent, warnings)
  };
}

function markdownResult(markdown, structuredContent) {
  return {
    content: [{ type: "text", text: markdown }],
    structuredContent
  };
}

async function trackNormalizationWarnings(db, warnings) {
  const normalizedWarnings = uniqueWarnings(warnings);
  if (!normalizedWarnings.length) {
    return;
  }

  if (normalizedWarnings.some((warning) => warning.includes("field key"))) {
    await incrementUsageMetric(db, "mcp.normalize.field-key");
  }

  if (normalizedWarnings.some((warning) => warning.includes("sourceType"))) {
    await incrementUsageMetric(db, "mcp.normalize.source-type");
  }
}

function parseJsonLikeInput(value) {
  if (typeof value === "string") {
    return JSON.parse(value);
  }

  return value;
}

function normalizeGeneratedFields(fields) {
  const normalized = normalizeFieldDefinitions(fields);
  if (normalized.errors.length) {
    throw new Error(normalized.errors[0]);
  }
  return normalized;
}

function buildCurrentUserProfile(siteUrl, user) {
  return {
    id: user.id,
    username: user.username,
    publicNamespace: user.publicNamespace,
    mockNamespaceUrl: `${siteUrl}/mock/${encodeURIComponent(user.publicNamespace)}`
  };
}

function normalizeQuickstartTopic(value) {
  const topic = String(value || "").trim().toLowerCase();
  if (!topic) {
    return "overview";
  }

  if (topic.includes("static")) {
    return "static-endpoint";
  }

  if (topic.includes("template") || topic.includes("schema")) {
    return "template-endpoint";
  }

  if (topic.includes("field") || topic.includes("discover") || topic.includes("search")) {
    return "field-discovery";
  }

  if (topic.includes("generate")) {
    return "generate-json";
  }

  return "overview";
}

export function buildQuickstartPayload(topic = "") {
  const resolvedTopic = normalizeQuickstartTopic(topic);

  const recipes = {
    "overview": [
      {
        title: "Discover available fields",
        tool: "jsonplace_search_field_options",
        arguments: { query: "company city phone", limit: 8 }
      },
      {
        title: "Generate a sample payload",
        tool: "jsonplace_generate_json",
        arguments: {
          fields: [
            { propName: "id", fieldKey: "random.uuid" },
            { propName: "company.name", fieldKey: "company.name" },
            { propName: "contact.email", fieldKey: "internet.email" }
          ]
        }
      },
      {
        title: "Create a template-backed endpoint",
        tool: "jsonplace_create_template_endpoint",
        arguments: {
          title: "Company Profile",
          endpointPath: "company/profile",
          fields: [
            { propName: "id", fieldKey: "random.uuid" },
            { propName: "company.name", fieldKey: "company.name" },
            { propName: "company.catchPhrase", fieldKey: "company.catchPhrase" },
            { propName: "location.city", fieldKey: "location.city" }
          ]
        }
      },
      {
        title: "Create a static endpoint",
        tool: "jsonplace_create_static_endpoint",
        arguments: {
          title: "Health Check",
          endpointPath: "status/health",
          responseJson: {
            status: "ok",
            version: "1.0.0"
          }
        }
      }
    ],
    "field-discovery": [
      {
        title: "List canonical field options",
        tool: "jsonplace_list_field_options",
        arguments: { limit: 20 }
      },
      {
        title: "Search by business/location terms",
        tool: "jsonplace_search_field_options",
        arguments: { query: "business location company address", limit: 12 }
      }
    ],
    "generate-json": [
      {
        title: "Generate JSON from compact fieldKey inputs",
        tool: "jsonplace_generate_json",
        arguments: {
          fields: [
            { propName: "user.id", fieldKey: "random.uuid" },
            { propName: "user.firstName", fieldKey: "person.firstName" },
            { propName: "user.lastName", fieldKey: "person.lastName" },
            { propName: "user.email", fieldKey: "internet.email" }
          ],
          sampleCount: 2
        }
      }
    ],
    "template-endpoint": [
      {
        title: "Create a template endpoint",
        tool: "jsonplace_create_template_endpoint",
        arguments: {
          title: "Local Business",
          endpointPath: "business/local",
          fields: [
            { propName: "id", fieldKey: "random.uuid" },
            { propName: "name", fieldKey: "company.name" },
            { propName: "phone", fieldKey: "phone.number" },
            { propName: "location.city", fieldKey: "location.city" },
            { propName: "location.streetAddress", fieldKey: "location.streetAddress" }
          ]
        }
      }
    ],
    "static-endpoint": [
      {
        title: "Create a static endpoint",
        tool: "jsonplace_create_static_endpoint",
        arguments: {
          title: "Feature Flags",
          endpointPath: "config/flags",
          responseJson: {
            betaCheckout: true,
            region: "eu-central"
          }
        }
      }
    ]
  };

  return {
    topic: resolvedTopic,
    recipes: recipes[resolvedTopic]
  };
}

function buildQuickstartMarkdown(payload) {
  const lines = [`# JsonPlace Quickstart`, "", `Topic: ${payload.topic}`, ""];

  payload.recipes.forEach((recipe, index) => {
    lines.push(`${index + 1}. ${recipe.title}`);
    lines.push(`Tool: \`${recipe.tool}\``);
    lines.push("Arguments:");
    lines.push("```json");
    lines.push(JSON.stringify(recipe.arguments, null, 2));
    lines.push("```");
    lines.push("");
  });

  return lines.join("\n").trim();
}

export function buildUsageGuideMarkdown(siteUrl) {
  const guide = [
    "# JsonPlace MCP Usage Guide",
    "",
    "## Canonical field format",
    "- Use canonical Faker-style `namespace.method` keys like `company.name`, `location.city`, and `phone.number`.",
    "- Legacy aliases are accepted and normalized, for example `company.companyName -> company.name` and `address.city -> location.city`.",
    "",
    "## Valid sourceType values",
    "- Canonical values: `template`, `staticJson`",
    "- Accepted aliases: `schema -> template`, `static -> staticJson`, `json -> staticJson`, `static_json -> staticJson`",
    "",
    "## Common recipes",
    "1. Discover fields with `jsonplace_search_field_options` before generating or saving templates.",
    "2. Use `jsonplace_generate_json` to preview field combinations.",
    "3. Use `jsonplace_create_template_endpoint` for dynamic payloads.",
    "4. Use `jsonplace_create_static_endpoint` for fixed JSON payloads.",
    "",
    "## Example: static endpoint",
    "```json",
    JSON.stringify(
      {
        title: "Service Status",
        endpointPath: "status/service",
        responseJson: {
          status: "ok",
          checkedAt: "2026-03-09T10:00:00.000Z"
        }
      },
      null,
      2
    ),
    "```",
    "",
    "## Example: template endpoint",
    "```json",
    JSON.stringify(
      {
        title: "Business Card",
        endpointPath: "business/card",
        fields: [
          { propName: "id", fieldKey: "random.uuid" },
          { propName: "company.name", fieldKey: "company.name" },
          { propName: "company.catchPhrase", fieldKey: "company.catchPhrase" },
          { propName: "contact.phone", fieldKey: "phone.number" },
          { propName: "contact.city", fieldKey: "location.city" }
        ]
      },
      null,
      2
    ),
    "```",
    "",
    "## Notes",
    "- `responseJson` can be passed as a JSON object/array or as a JSON string.",
    "- Your canonical public namespace URL is `/mock/{publicNamespace}/{endpointPath}`.",
    `- Base site URL: ${siteUrl}`
  ];

  return guide.join("\n");
}

export function createJsonPlaceMcpServer({ db, user, siteUrl }) {
  const server = new McpServer(
    {
      name: "jsonplace",
      version: "2.2.0"
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  server.registerResource(
    "jsonplace-field-options",
    "jsonplace://catalog/field-options",
    {
      title: "JsonPlace Field Options",
      description: "Canonical JsonPlace field groups, keys, aliases, and tags.",
      mimeType: "application/json"
    },
    async () => ({
      contents: [
        {
          uri: "jsonplace://catalog/field-options",
          text: JSON.stringify(getFieldCatalog(), null, 2)
        }
      ]
    })
  );

  server.registerResource(
    "jsonplace-usage-guide",
    "jsonplace://catalog/usage-guide",
    {
      title: "JsonPlace MCP Usage Guide",
      description: "Recipes and conventions for using the JsonPlace MCP server effectively.",
      mimeType: "text/markdown"
    },
    async () => ({
      contents: [
        {
          uri: "jsonplace://catalog/usage-guide",
          text: buildUsageGuideMarkdown(siteUrl)
        }
      ]
    })
  );

  server.registerResource(
    "jsonplace-ready-templates",
    "jsonplace://catalog/starter-templates",
    {
      title: "JsonPlace Starter Templates",
      description: "Starter templates available to all JsonPlace users.",
      mimeType: "application/json"
    },
    async () => ({
      contents: [
        {
          uri: "jsonplace://catalog/starter-templates",
          text: JSON.stringify(readyTemplates, null, 2)
        }
      ]
    })
  );

  server.registerResource(
    "jsonplace-user-profile",
    "jsonplace://me/profile",
    {
      title: "JsonPlace Profile",
      description: "The authenticated JsonPlace user profile for this MCP connection.",
      mimeType: "application/json"
    },
    async () => ({
      contents: [
        {
          uri: "jsonplace://me/profile",
          text: JSON.stringify(buildCurrentUserProfile(siteUrl, user), null, 2)
        }
      ]
    })
  );

  server.registerResource(
    "jsonplace-user-templates",
    "jsonplace://me/templates",
    {
      title: "JsonPlace Templates",
      description: "Templates owned by the authenticated JsonPlace user.",
      mimeType: "application/json"
    },
    async () => ({
      contents: [
        {
          uri: "jsonplace://me/templates",
          text: JSON.stringify(await listTemplatesForUser(db, user, 100), null, 2)
        }
      ]
    })
  );

  server.registerResource(
    "jsonplace-user-mock-endpoints",
    "jsonplace://me/mock-endpoints",
    {
      title: "JsonPlace Mock Endpoints",
      description: "Mock endpoints owned by the authenticated JsonPlace user.",
      mimeType: "application/json"
    },
    async () => ({
      contents: [
        {
          uri: "jsonplace://me/mock-endpoints",
          text: JSON.stringify(await listMockEndpointsForUser(db, user, siteUrl, 100), null, 2)
        }
      ]
    })
  );

  server.registerTool(
    "jsonplace_whoami",
    {
      title: "JsonPlace Who Am I",
      description: "Return the authenticated JsonPlace user profile, including the public mock namespace.",
      inputSchema: z.object({})
    },
    async () => {
      const profile = buildCurrentUserProfile(siteUrl, user);
      return jsonResult(profile);
    }
  );

  server.registerTool(
    "jsonplace_list_field_options",
    {
      title: "List JsonPlace Field Options",
      description: "List canonical field options exposed by JsonPlace, optionally filtered by group.",
      inputSchema: z.object({
        group: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional().default(50)
      })
    },
    async ({ group, limit }) => {
      const fields = listFieldOptions({ group, limit });
      return jsonResult({ fields });
    }
  );

  server.registerTool(
    "jsonplace_search_field_options",
    {
      title: "Search JsonPlace Field Options",
      description: "Search canonical field options by key, alias, label, or tags.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(100).optional().default(25)
      })
    },
    async ({ query, limit }) => {
      const fields = searchFieldOptions(query, { limit });
      return jsonResult({ fields });
    }
  );

  server.registerTool(
    "jsonplace_quickstart",
    {
      title: "JsonPlace Quickstart",
      description: "Return short JsonPlace MCP recipes for field discovery, JSON generation, and endpoint creation.",
      inputSchema: z.object({
        topic: z.string().optional().default("")
      })
    },
    async ({ topic }) => {
      const payload = buildQuickstartPayload(topic);
      return markdownResult(buildQuickstartMarkdown(payload), payload);
    }
  );

  server.registerTool(
    "jsonplace_generate_json",
    {
      title: "Generate JsonPlace JSON",
      description: "Generate one or more JSON payloads from JsonPlace field definitions.",
      inputSchema: z.object({
        fields: z.array(fieldSchema).min(1).max(200),
        sampleCount: z.number().int().min(1).max(100).default(1)
      })
    },
    async ({ fields, sampleCount }) => {
      const normalized = normalizeGeneratedFields(fields);
      await trackNormalizationWarnings(db, normalized.warnings);
      const payload = generateSamplesFromFields(normalized.fields, sampleCount);
      return jsonResult(
        {
          payload,
          fields: normalized.fields
        },
        { payload, fields: normalized.fields },
        normalized.warnings
      );
    }
  );

  server.registerTool(
    "jsonplace_infer_fields_from_json",
    {
      title: "Infer JsonPlace Fields",
      description: "Infer JsonPlace field definitions from a single example JSON object.",
      inputSchema: z.object({
        json: z.any()
      })
    },
    async ({ json }) => {
      const parsed = parseJsonLikeInput(json);
      const fields = buildFieldsFromJsonObject(parsed);
      return jsonResult({ fields });
    }
  );

  server.registerTool(
    "jsonplace_list_templates",
    {
      title: "List JsonPlace Templates",
      description: "List saved templates for the authenticated JsonPlace user.",
      inputSchema: z.object({})
    },
    async () => {
      const templates = await listTemplatesForUser(db, user, 100);
      return jsonResult({ templates });
    }
  );

  server.registerTool(
    "jsonplace_save_template",
    {
      title: "Save JsonPlace Template",
      description: "Save a new template to the authenticated JsonPlace account.",
      inputSchema: z.object({
        title: z.string(),
        description: z.string().optional().default(""),
        fields: z.array(fieldSchema).min(1).max(200)
      })
    },
    async ({ title, description, fields }) => {
      const validation = validateTemplateInput({ title, description, fields });
      if (!validation.ok) {
        throw new Error(validation.error);
      }

      await trackNormalizationWarnings(db, validation.warnings);
      const template = await createTemplateForUser(db, user, validation.value);
      return jsonResult({ template }, { template }, validation.warnings);
    }
  );

  server.registerTool(
    "jsonplace_delete_template",
    {
      title: "Delete JsonPlace Template",
      description: "Delete one saved JsonPlace template.",
      inputSchema: z.object({
        templateId: z.string()
      })
    },
    async ({ templateId }) => {
      await deleteTemplateForUser(db, user, templateId);
      return jsonResult({ success: true, message: "Template deleted." });
    }
  );

  server.registerTool(
    "jsonplace_list_mock_endpoints",
    {
      title: "List JsonPlace Mock Endpoints",
      description: "List saved mock endpoints for the authenticated JsonPlace user.",
      inputSchema: z.object({})
    },
    async () => {
      const endpoints = await listMockEndpointsForUser(db, user, siteUrl, 100);
      return jsonResult({ endpoints });
    }
  );

  server.registerTool(
    "jsonplace_create_template_endpoint",
    {
      title: "Create JsonPlace Template Endpoint",
      description: "Create a saved template-backed JsonPlace mock endpoint for the authenticated user.",
      inputSchema: z.object({
        title: z.string(),
        description: z.string().optional().default(""),
        endpointPath: z.string(),
        fields: z.array(fieldSchema).min(1).max(200)
      })
    },
    async ({ title, description, endpointPath, fields }) => {
      const validation = validateMockEndpointInput({
        title,
        description,
        endpointPath,
        fields
      }, {
        forcedSourceType: MOCK_SOURCE_TYPES.template
      });

      if (!validation.ok) {
        throw new Error(validation.error);
      }

      await trackNormalizationWarnings(db, validation.warnings);
      const endpoint = await createMockEndpointForUser(db, user, validation.value, siteUrl);
      return jsonResult({ endpoint }, { endpoint }, validation.warnings);
    }
  );

  server.registerTool(
    "jsonplace_create_static_endpoint",
    {
      title: "Create JsonPlace Static Endpoint",
      description: "Create a saved static JsonPlace mock endpoint for the authenticated user.",
      inputSchema: z.object({
        title: z.string(),
        description: z.string().optional().default(""),
        endpointPath: z.string(),
        responseJson: z.any()
      })
    },
    async ({ title, description, endpointPath, responseJson }) => {
      const validation = validateMockEndpointInput({
        title,
        description,
        endpointPath,
        responseJson
      }, {
        forcedSourceType: MOCK_SOURCE_TYPES.staticJson
      });

      if (!validation.ok) {
        throw new Error(validation.error);
      }

      await trackNormalizationWarnings(db, validation.warnings);
      const endpoint = await createMockEndpointForUser(db, user, validation.value, siteUrl);
      return jsonResult({ endpoint }, { endpoint }, validation.warnings);
    }
  );

  server.registerTool(
    "jsonplace_update_template_endpoint",
    {
      title: "Update JsonPlace Template Endpoint",
      description: "Update one saved template-backed JsonPlace mock endpoint.",
      inputSchema: z.object({
        endpointId: z.string(),
        title: z.string(),
        description: z.string().optional().default(""),
        endpointPath: z.string(),
        fields: z.array(fieldSchema).min(1).max(200)
      })
    },
    async ({ endpointId, title, description, endpointPath, fields }) => {
      const validation = validateMockEndpointInput({
        title,
        description,
        endpointPath,
        fields
      }, {
        forcedSourceType: MOCK_SOURCE_TYPES.template
      });

      if (!validation.ok) {
        throw new Error(validation.error);
      }

      await trackNormalizationWarnings(db, validation.warnings);
      const endpoint = await updateMockEndpointForUser(db, user, endpointId, validation.value, siteUrl);
      return jsonResult({ endpoint }, { endpoint }, validation.warnings);
    }
  );

  server.registerTool(
    "jsonplace_update_static_endpoint",
    {
      title: "Update JsonPlace Static Endpoint",
      description: "Update one saved static JsonPlace mock endpoint.",
      inputSchema: z.object({
        endpointId: z.string(),
        title: z.string(),
        description: z.string().optional().default(""),
        endpointPath: z.string(),
        responseJson: z.any()
      })
    },
    async ({ endpointId, title, description, endpointPath, responseJson }) => {
      const validation = validateMockEndpointInput({
        title,
        description,
        endpointPath,
        responseJson
      }, {
        forcedSourceType: MOCK_SOURCE_TYPES.staticJson
      });

      if (!validation.ok) {
        throw new Error(validation.error);
      }

      await trackNormalizationWarnings(db, validation.warnings);
      const endpoint = await updateMockEndpointForUser(db, user, endpointId, validation.value, siteUrl);
      return jsonResult({ endpoint }, { endpoint }, validation.warnings);
    }
  );

  server.registerTool(
    "jsonplace_create_mock_endpoint",
    {
      title: "Create JsonPlace Mock Endpoint (Legacy)",
      description: "Legacy polymorphic endpoint creator. Prefer jsonplace_create_template_endpoint or jsonplace_create_static_endpoint.",
      inputSchema: z.object({
        title: z.string(),
        description: z.string().optional().default(""),
        endpointPath: z.string(),
        sourceType: z.string().optional().default("template"),
        fields: z.array(fieldSchema).optional().default([]),
        responseJson: z.any().optional().default(null)
      })
    },
    async (payload) => {
      const validation = validateMockEndpointInput(payload);
      if (!validation.ok) {
        throw new Error(validation.error);
      }

      await incrementUsageMetric(db, "mcp.tool.legacy-create-mock-endpoint");
      await trackNormalizationWarnings(db, validation.warnings);
      const endpoint = await createMockEndpointForUser(db, user, validation.value, siteUrl);
      return jsonResult({ endpoint }, { endpoint }, validation.warnings);
    }
  );

  server.registerTool(
    "jsonplace_update_mock_endpoint",
    {
      title: "Update JsonPlace Mock Endpoint (Legacy)",
      description: "Legacy polymorphic endpoint updater. Prefer jsonplace_update_template_endpoint or jsonplace_update_static_endpoint.",
      inputSchema: z.object({
        endpointId: z.string(),
        title: z.string(),
        description: z.string().optional().default(""),
        endpointPath: z.string(),
        sourceType: z.string().optional().default("template"),
        fields: z.array(fieldSchema).optional().default([]),
        responseJson: z.any().optional().default(null)
      })
    },
    async ({ endpointId, ...payload }) => {
      const validation = validateMockEndpointInput(payload);
      if (!validation.ok) {
        throw new Error(validation.error);
      }

      await incrementUsageMetric(db, "mcp.tool.legacy-update-mock-endpoint");
      await trackNormalizationWarnings(db, validation.warnings);
      const endpoint = await updateMockEndpointForUser(db, user, endpointId, validation.value, siteUrl);
      return jsonResult({ endpoint }, { endpoint }, validation.warnings);
    }
  );

  server.registerTool(
    "jsonplace_delete_mock_endpoint",
    {
      title: "Delete JsonPlace Mock Endpoint",
      description: "Delete one saved JsonPlace mock endpoint.",
      inputSchema: z.object({
        endpointId: z.string()
      })
    },
    async ({ endpointId }) => {
      await deleteMockEndpointForUser(db, user, endpointId);
      return jsonResult({ success: true, message: "Mock endpoint deleted." });
    }
  );

  server.registerTool(
    "jsonplace_get_public_mock_response",
    {
      title: "Fetch Public JsonPlace Mock Response",
      description: "Resolve the current JSON payload for a JsonPlace public mock endpoint using a username or public namespace.",
      inputSchema: z.object({
        endpointPath: z.string(),
        owner: z.string().optional(),
        username: z.string().optional()
      })
    },
    async ({ endpointPath, owner, username }) => {
      const ownerIdentifier = String(owner || username || user.publicNamespace || user.username);
      const result = await getPublicMockEndpoint(db, ownerIdentifier, endpointPath);
      if (result.ownerMatchType === "username") {
        await incrementUsageMetric(db, "mcp.public.lookup.legacy-username");
      }
      const response = buildPublicMockResponse(siteUrl, result.ownerPublicNamespace, result.endpointPath, result.payload);
      return jsonResult(response);
    }
  );

  return server;
}
