# MCP (Model Context Protocol)

NoteLoom can connect to MCP servers so the AI agent can call external tools and read resources you configure.

Servers are **never** started until you add them in Settings. Only servers you leave **enabled** auto-connect on app launch.

## Add a server

1. Open **Settings → MCP**.
2. Optionally use **Check Environment** to verify `npx` / `uvx` / Python are available (desktop).
3. Click **Add Server** (or **Import JSON** for Cursor/Claude Desktop-style `mcpServers` configs).
4. Choose a type:
   - **Local Command (stdio)** — desktop only. Runs a local process (recommended for most community servers).
   - **HTTP Service** — Streamable HTTP / JSON-RPC endpoint (desktop and mobile).
5. Use **Test Connection**, then **Save**.
6. Leave **Enable Server** on if you want it to connect now and on next launch.

### Example: filesystem (stdio)

Requires Node.js / `npx` on your PATH.

| Field | Value |
| --- | --- |
| Name | `Filesystem` |
| Type | Local Command |
| Command | `npx -y @modelcontextprotocol/server-filesystem /path/to/allowed/folder` |

You can put the full command in **Command** and leave **Arguments** empty, or split command and args.

### Example: HTTP MCP

| Field | Value |
| --- | --- |
| Name | `My HTTP MCP` |
| Type | HTTP Service |
| URL | `http://localhost:3000/mcp` |
| Headers | Optional JSON, e.g. `{"Authorization":"Bearer …"}` |

## Connect, status, and tools

- The toggle on each server **enables/disables** it. Enabling connects; disabling disconnects and skips launch auto-connect.
- Use **Connect** / **Reconnect** / **Disconnect** on a server row for an immediate connection change without editing the config.
- Status badges: Connected, Connecting, Disconnected, Error (with the English error text when available).
- Expand a connected server to browse its tools.

Config is stored in the app store (`mcp.servers`, `mcp.selectedServerIds` in `store.json`).

## Use MCP tools in chat

1. In the chat toolbar, open **MCP Servers**.
2. Toggle the servers you want available for this conversation (only **enabled** servers appear).
3. Ask the agent to use those tools. The agent can:
   - Call registered MCP tools directly (when schema/budget allows)
   - Use `mcp_list_tools`, `mcp_call_tool`, and resource helpers for inspection / deferred tools

Selected servers that are enabled but disconnected are reconnected at the start of an agent turn when possible.

## Security notes

- Only add servers you trust. Stdio servers run as local processes with the command and env you provide.
- **Trust tool permission hints** is off by default. Turn it on only for trusted servers; read-only hints may skip approval, while destructive calls still require confirmation.
- Secrets in URLs/headers are redacted in UI endpoints and error toasts where possible — prefer env vars / headers over putting tokens in the command line.
- Mobile supports **HTTP MCP only**; local command servers require the desktop app.

## Import JSON

Paste a Cursor-compatible block:

```json
{
  "mcpServers": {
    "fetch": {
      "command": "npx",
      "args": ["-y", "mcp-server-fetch"]
    }
  }
}
```

Imported servers that are enabled will attempt to connect immediately after import.
