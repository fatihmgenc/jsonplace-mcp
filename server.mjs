import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createJsonPlaceMcpServer } from "./lib/mcpServer.js";
import { getDb } from "./lib/mongodb.js";
import { ensureAuthIndexes } from "./lib/auth.js";
import {
  ANONYMOUS_RATE_LIMIT_MESSAGE,
  checkAnonymousMcpRateLimit,
  resolveMcpRequestContext
} from "./lib/mcpAuth.js";
import { getSiteUrl } from "./lib/site.js";

const port = Number.parseInt(process.env.PORT || "3002", 10);
const LEGACY_OAUTH_PATHS = [
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource/mcp",
  "/authorize",
  "/token",
  "/register",
  "/revoke",
  "/oauth/authorize/continue/:requestId"
];

function buildRetiredAuthPayload(siteUrl) {
  return {
    error: "oauth_retired",
    message: "JsonPlace no longer supports OAuth for MCP connections. Connect to the hosted MCP URL directly for public tools, or add Authorization: Bearer <JSONPLACE_API_KEY> for saved templates and endpoint management.",
    mcpUrl: new URL("/mcp", `${siteUrl}/`).toString(),
    docsUrl: new URL("/docs/mcp", `${siteUrl}/`).toString()
  };
}

function buildRetiredAuthHtml(siteUrl) {
  const payload = buildRetiredAuthPayload(siteUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>JsonPlace OAuth Retired</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; min-height: 100vh; display: grid; place-items: center; }
      main { width: min(520px, calc(100vw - 32px)); border: 1px solid rgba(148, 163, 184, 0.24); border-radius: 16px; padding: 24px; background: rgba(15, 23, 42, 0.92); }
      p, li { color: #cbd5e1; line-height: 1.55; }
      code { background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 6px; padding: 2px 6px; }
      a { color: #fbbf24; }
    </style>
  </head>
  <body>
    <main>
      <h1>JsonPlace OAuth Retired</h1>
      <p>${payload.message}</p>
      <ol>
        <li>Open the JsonPlace MCP docs.</li>
        <li>Connect without auth if you only need public JSON generation or one-off mock endpoints.</li>
        <li>Add <code>Authorization: Bearer &lt;JSONPLACE_API_KEY&gt;</code> if you want saved templates and endpoint management.</li>
        <li>Reconnect to <code>${payload.mcpUrl}</code>.</li>
      </ol>
      <p><a href="${payload.docsUrl}">Open the JsonPlace MCP guide</a></p>
    </main>
  </body>
</html>`;
}

function sendRetiredAuthResponse(req, res, siteUrl) {
  const acceptsHtml = String(req.headers.accept || "").includes("text/html");
  if (acceptsHtml) {
    res.status(410).setHeader("Cache-Control", "no-store").send(buildRetiredAuthHtml(siteUrl));
    return;
  }

  res.status(410).setHeader("Cache-Control", "no-store").json(buildRetiredAuthPayload(siteUrl));
}

function sendJsonRpcError(res, { status, code, message }) {
  res.status(status).setHeader("Cache-Control", "no-store").json({
    jsonrpc: "2.0",
    error: {
      code,
      message
    },
    id: null
  });
}

async function bootstrap() {
  const db = await getDb();
  await ensureAuthIndexes(db);

  const siteUrl = getSiteUrl();
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.all(LEGACY_OAUTH_PATHS, (req, res) => {
    sendRetiredAuthResponse(req, res, siteUrl);
  });

  app.post(
    "/mcp",
    express.json({ limit: "1mb" }),
    async (req, res) => {
      try {
        const authContext = await resolveMcpRequestContext(req, db);
        if (!authContext.ok) {
          sendJsonRpcError(res, authContext);
          return;
        }

        if (authContext.authMode === "anonymous") {
          const rate = checkAnonymousMcpRateLimit(req);
          if (!rate.allowed) {
            sendJsonRpcError(res, {
              status: 429,
              code: -32029,
              message: ANONYMOUS_RATE_LIMIT_MESSAGE
            });
            return;
          }
        }

        const server = createJsonPlaceMcpServer({
          db,
          user: authContext.user,
          authMode: authContext.authMode,
          siteUrl
        });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);

        res.on("close", () => {
          transport.close();
          server.close();
        });
      } catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error"
            },
            id: null
          });
        }
      }
    }
  );

  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    });
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "jsonplace-mcp" });
  });

  app.listen(port, () => {
    console.log(`JsonPlace MCP listening on ${siteUrl} (port ${port})`);
  });
}

bootstrap().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
