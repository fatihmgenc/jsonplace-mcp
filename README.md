# JsonPlace MCP

JsonPlace MCP is the standalone hosted MCP service for JsonPlace.

It exposes the JsonPlace MCP server, OAuth flow, and related metadata endpoints as a separate Node/Express service while continuing to use the same MongoDB-backed JsonPlace accounts, templates, mock endpoints, sessions, and OAuth collections as the website.

## What This Repo Contains

- standalone MCP HTTP service at `/mcp`
- OAuth provider and authorization-continue pages
- JsonPlace MCP tools and resources
- shared JsonPlace domain logic required by the MCP service

## Required Environment Variables

- `MONGODB_URI`

## Optional Environment Variables

- `MONGODB_DB_NAME`
  Defaults to `JsonPlace`
- `JSONPLACE_SITE_URL`
  Canonical public URL used for OAuth metadata, redirects, and generated public URLs
- `PORT`
  Defaults to `3002`

## Development

```bash
npm install
MONGODB_URI='your-mongodb-uri' JSONPLACE_SITE_URL='https://jsonplace.com' npm run dev
```

## Production Notes

This service is intended to sit behind the main JsonPlace domain through reverse proxy or gateway routing. Route these paths to the MCP service:

- `/mcp`
- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-protected-resource/mcp`
- `/authorize`
- `/token`
- `/register`
- `/revoke`
- `/oauth/authorize/continue/:requestId`

All other website traffic should continue to resolve to the main JsonPlace web app.
