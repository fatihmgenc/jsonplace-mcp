# JsonPlace MCP - Fake JSON and Mock APIs Inside Your MCP Client

JsonPlace MCP lets your agent generate JSON payloads, manage saved templates, and create or update mock API endpoints directly from your MCP client.

## Without JsonPlace MCP

You end up describing fake payloads manually in prompts.

- Code and API agents cannot see your saved JsonPlace templates or endpoints.
- You keep switching between your editor and JsonPlace to copy JSON or public URLs.
- Mock API setup becomes repetitive every time you need new test data.

## With JsonPlace MCP

Your agent can work with JsonPlace directly through one remote MCP connection.

- Create and update template-backed endpoints without leaving the client.
- Create static JSON endpoints for health checks, config payloads, or fixtures.
- List saved templates and endpoints from the same JsonPlace account you use on the web.
- Generate payloads or infer field definitions from sample JSON on demand.

## Installation

Use the hosted remote MCP server:

```text
https://jsonplace.com/mcp
```

### Install in Codex

If you want a one-time paste-and-forget setup, add JsonPlace directly to `~/.codex/config.toml`:

```toml
[mcp_servers.jsonplace]
url = "https://jsonplace.com/mcp"
http_headers = { Authorization = "Bearer jpak_your_real_key_here" }
```

If you prefer an environment variable in Codex instead, use:

```toml
[mcp_servers.jsonplace]
url = "https://jsonplace.com/mcp"
bearer_token_env_var = "JSONPLACE_API_KEY"
```

### Install in Cursor

Paste the key directly, or replace it with `${env:JSONPLACE_API_KEY}` if you prefer env vars.

```json
{
  "mcpServers": {
    "jsonplace": {
      "url": "https://jsonplace.com/mcp",
      "headers": {
        "Authorization": "Bearer jpak_your_real_key_here"
      }
    }
  }
}
```

Suggested locations:

- `~/.cursor/mcp.json`
- `.cursor/mcp.json`

### Install in Claude Code

Paste the key directly into the command, or swap it for `$JSONPLACE_API_KEY` if you prefer env vars:

```bash
claude mcp add --transport http --scope user --header "Authorization: Bearer jpak_your_real_key_here" jsonplace https://jsonplace.com/mcp
```

### Install in Opencode

Add JsonPlace as a remote MCP server in your Opencode config. Paste the key directly, or replace it with `${JSONPLACE_API_KEY}` if you prefer env vars:

```json
{
  "mcp": {
    "jsonplace": {
      "type": "remote",
      "url": "https://jsonplace.com/mcp",
      "headers": {
        "Authorization": "Bearer jpak_your_real_key_here"
      },
      "enabled": true
    }
  }
}
```

## API Key Authentication

JsonPlace uses bearer API keys for remote MCP connections.

Simple flow:

1. Sign in on `jsonplace.com` and open the `MCP` tab.
2. Copy or regenerate your account API key.
3. Either paste it directly into your client config or store it as `JSONPLACE_API_KEY`.
4. Configure your MCP client to send `Authorization: Bearer <your JsonPlace API key>` to `https://jsonplace.com/mcp`.

You do not need to run a local JsonPlace MCP process when using the hosted server.

## Important Tips

### Add a Rule

To avoid repeating yourself, add a client rule so your assistant reaches for JsonPlace MCP when you ask for fake JSON or mock APIs.

Example rule:

```text
Always use JsonPlace MCP when I ask for fake JSON payloads, JSON field generation, template-backed mock APIs, static mock responses, or saved mock endpoint management.
```

### Ask for Outcomes, Not Tool Names

You usually do not need to mention tool names. Just ask for the result you want.

Examples:

- "Create a static endpoint at `status/health` that returns `{\"status\":\"ok\"}`."
- "List my saved JsonPlace templates and pick the best one for a company profile endpoint."
- "Generate a user payload with id, name, city, email, and phone."
- "Show me the current public response for my `status/health` endpoint."

## Example Prompts

```text
List my saved JsonPlace templates and mock endpoints, then suggest which one fits a health-check API.
```

```text
Create a static JsonPlace endpoint at status/health that returns {"status":"ok"}.
```

```text
Generate a company profile payload with name, city, phone, and email, then save it as a template-backed JsonPlace endpoint.
```

```text
Show me the current response for my public JsonPlace endpoint at status/health.
```

## What JsonPlace MCP Can Do

### Discover and Generate Data

- List canonical JsonPlace field options
- Search the field catalog by keywords
- Generate JSON payloads from field definitions
- Infer field definitions from a sample JSON object

### Manage Templates

- List saved templates
- Save new templates
- Delete templates

### Manage Mock Endpoints

- List saved mock endpoints
- Create template-backed mock endpoints
- Create static JSON mock endpoints
- Update existing endpoints
- Delete endpoints

### Resolve Public Payloads

- Fetch the current payload behind a public JsonPlace endpoint

## Available Tools

JsonPlace MCP currently exposes these tools:

- `jsonplace_whoami`
- `jsonplace_list_field_options`
- `jsonplace_search_field_options`
- `jsonplace_quickstart`
- `jsonplace_generate_json`
- `jsonplace_infer_fields_from_json`
- `jsonplace_list_templates`
- `jsonplace_save_template`
- `jsonplace_delete_template`
- `jsonplace_list_mock_endpoints`
- `jsonplace_create_template_endpoint`
- `jsonplace_create_static_endpoint`
- `jsonplace_update_template_endpoint`
- `jsonplace_update_static_endpoint`
- `jsonplace_create_mock_endpoint`
- `jsonplace_update_mock_endpoint`
- `jsonplace_delete_mock_endpoint`
- `jsonplace_get_public_mock_response`

## Self-Hosting and Development

This repository contains the standalone JsonPlace MCP service. It exposes the MCP server as a separate Node service while continuing to use the same MongoDB-backed accounts, templates, mock endpoints, sessions, and API key collection as the website.

## License

MIT. See [LICENSE](LICENSE).
