# JsonPlace MCP - Fake JSON and Mock APIs Inside Your MCP Client

JsonPlace MCP lets your agent generate JSON payloads, create mock API endpoints, and optionally manage saved templates and saved endpoints directly from your MCP client.

Public setup docs also live on the website at `https://jsonplace.com/docs/mcp`, with client-specific pages for Codex, Cursor, Claude Code, Opencode, AGENTS.md instructions, and concrete recipe pages.

## Without JsonPlace MCP

You end up describing fake payloads manually in prompts.

- Code and API agents cannot see your saved JsonPlace templates or endpoints.
- You keep switching between your editor and JsonPlace to copy JSON or public URLs.
- Mock API setup becomes repetitive every time you need new test data.

## With JsonPlace MCP

Your agent can work with JsonPlace directly through one remote MCP connection.

- Generate JSON and create public mock endpoints without any login.
- Create static JSON endpoints for health checks, config payloads, or fixtures.
- Add an API key later to list saved templates and manage saved endpoints from the same JsonPlace account you use on the web.
- Generate payloads or infer field definitions from sample JSON on demand.

## Installation

Use the hosted remote MCP server:

```text
https://jsonplace.com/mcp
```

### Install in Codex

Start with public mode:

```toml
[mcp_servers.jsonplace]
url = "https://jsonplace.com/mcp"
```

Optional account upgrade:

```toml
[mcp_servers.jsonplace]
url = "https://jsonplace.com/mcp"
http_headers = { Authorization = "Bearer jpak_your_real_key_here" }
```

### Install in Cursor

Start with public mode:

```json
{
  "mcpServers": {
    "jsonplace": {
      "url": "https://jsonplace.com/mcp"
    }
  }
}
```

Optional account upgrade:

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

Start with public mode:

```bash
claude mcp add --transport http --scope user jsonplace https://jsonplace.com/mcp
```

Optional account upgrade:

```bash
claude mcp add --transport http --scope user --header "Authorization: Bearer jpak_your_real_key_here" jsonplace https://jsonplace.com/mcp
```

### Install in Opencode

Start with public mode:

```json
{
  "mcp": {
    "jsonplace": {
      "type": "remote",
      "url": "https://jsonplace.com/mcp",
      "enabled": true
    }
  }
}
```

Optional account upgrade:

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

JsonPlace works without any API key for public tools. Bearer API keys are only needed for account-backed MCP features.

Simple flow:

1. Connect your MCP client to `https://jsonplace.com/mcp`.
2. Use public mode immediately for fake JSON generation and one-off public mock endpoints.
3. Sign in on `jsonplace.com/docs/mcp` only if you want saved templates or endpoint management.
4. Copy your account API key and add `Authorization: Bearer <your JsonPlace API key>` to your client config when you need those account features.

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

- List saved templates with an API key
- Save new templates with an API key
- Delete templates with an API key

### Manage Mock Endpoints

- Create template-backed mock endpoints
- Create static JSON mock endpoints
- List saved mock endpoints with an API key
- Update existing endpoints with an API key
- Delete endpoints with an API key

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
