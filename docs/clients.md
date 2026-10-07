# MCP client setup

The same stdio server (`dist/transport/stdio.js`) works with every client below. No
client needs changes to JEV Core, the provider or the tools.

Before connecting any client:

```bash
npm install
npm run build
```

Put `TYPESAFE_API_KEY` in `.env` at the repository root. The server loads it on
start; variables set in the client's own `env` configuration take precedence. If a
client cannot find `node`, replace `node` with its absolute path.

Paths below use `/absolute/path/to/jev-mcp`; on Windows use a path such as
`D:/Dev/jev-mcp`.

## Status

| Client | Transport | Status |
| --- | --- | --- |
| Claude Code | stdio | Verified end to end (2026-10-07, Claude Code 2.1.289) |
| Codex CLI | stdio | Verified end to end (2026-10-07, codex-cli 0.160.0) |
| Claude Code in VS Code (extension) | stdio | Verified end to end (2026-10-07); uses `.mcp.json` |
| VS Code Copilot agent mode | stdio | Workspace config provided, not yet verified |
| Claude Desktop | stdio | Verified end to end (2026-10-07, Windows) |
| ChatGPT | stdio via Secure MCP Tunnel | Verified end to end (2026-10-07, tunnel-client 0.0.16) |

Both verified clients rewrite the tool names: `jev.evaluate` appears as
`mcp__jev__jev_evaluate` and `jev.models` as `mcp__jev__jev_models`. Both accepted
the input and output schemas unchanged and received `structuredContent`.

## Claude Code

The repository ships a project-scoped [.mcp.json](../.mcp.json). Start Claude Code in
the repository root, approve the `jev` server, and check it with `/mcp`.

From another project:

```bash
claude mcp add jev -- node /absolute/path/to/jev-mcp/dist/transport/stdio.js
```

## Codex CLI

```bash
codex mcp add jev -- node /absolute/path/to/jev-mcp/dist/transport/stdio.js
```

This writes the following to `~/.codex/config.toml`:

```toml
[mcp_servers.jev]
command = "node"
args = ["/absolute/path/to/jev-mcp/dist/transport/stdio.js"]
```

For a one-off run without changing the config:

```bash
codex exec \
  -c 'mcp_servers.jev.command="node"' \
  -c 'mcp_servers.jev.args=["/absolute/path/to/jev-mcp/dist/transport/stdio.js"]' \
  "Call the jev models tool"
```

## VS Code Copilot agent mode

This section is for VS Code's built-in Copilot chat. The Claude Code extension for
VS Code does not use it; it reads `.mcp.json` like the Claude Code CLI.

The repository ships a workspace [.vscode/mcp.json](../.vscode/mcp.json). Open the
repository folder, then start the `jev` server from the MCP view or the
`MCP: List Servers` command.

For other workspaces, add the same entry to that workspace's `.vscode/mcp.json` with
an absolute path in `args`.

## Claude Desktop

Add to `claude_desktop_config.json` (Windows: `%APPDATA%\Claude\`, macOS:
`~/Library/Application Support/Claude/`), then fully quit Claude Desktop (from the
tray or menu bar, not just the window) and start it again:

```json
{
  "mcpServers": {
    "jev": {
      "command": "node",
      "args": ["/absolute/path/to/jev-mcp/dist/transport/stdio.js"]
    }
  }
}
```

## ChatGPT

ChatGPT cannot launch local stdio servers. It reaches custom MCP servers either at
a public HTTPS endpoint (Streamable HTTP) or through OpenAI's
[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).
This project uses the tunnel, which needs no code changes and opens no inbound
port: [`tunnel-client`](https://github.com/openai/tunnel-client) launches the stdio
server locally and long-polls OpenAI over outbound HTTPS. Only users in your OpenAI
organization and ChatGPT workspace with tunnel access can call it.

Requirements:

- Access to Tunnels in the OpenAI Platform organization, with Tunnels **Read** +
  **Use** (and **Manage** to create a tunnel)
- A ChatGPT plan and workspace that allow adding custom MCP servers

### 1. Create the tunnel and runtime key

1. In [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels),
   create a tunnel and copy its ID (`tunnel_...`).
2. In [Platform API keys](https://platform.openai.com/settings/organization/api-keys),
   create a runtime key for `tunnel-client`. Keep it out of this repository.

### 2. Install `tunnel-client`

Download the archive for your platform from the
[latest release](https://github.com/openai/tunnel-client/releases/latest) and
check it against `SHA256SUMS.txt` from the same release. On macOS, use
`brew install openai/tools/tunnel-client`.

### 3. Create a profile for jev-mcp

```bash
tunnel-client init \
  --profile jev \
  --tunnel-id tunnel_... \
  --mcp-command "node /absolute/path/to/jev-mcp/dist/transport/stdio.js"
```

The profile reads the runtime key from the `CONTROL_PLANE_API_KEY` environment
variable (`env:CONTROL_PLANE_API_KEY`). To start the tunnel without setting the
variable each time, keep the key in a file outside this repository and change
`control_plane.api_key` in the profile to `file:/path/to/key-file`.

### 4. Run the tunnel

```bash
export CONTROL_PLANE_API_KEY="..."   # PowerShell: $env:CONTROL_PLANE_API_KEY = "..."
tunnel-client doctor --profile jev --explain
tunnel-client run --profile jev
```

Keep `tunnel-client run` running while ChatGPT uses the server. Run only one
instance per tunnel ID; stop the old one before starting a new one.

### 5. Add the server in ChatGPT

While `tunnel-client run` is healthy, go to
[ChatGPT Plugins](https://chatgpt.com/plugins), select **+** then
**Add custom MCP server**, choose **Tunnel** under **Connection**, and enter the
tunnel ID. Set authentication to **No authentication**: the stdio server has no
OAuth metadata, and the default OAuth setting fails with "OAuth configuration not
found". Access is still limited to your organization and workspace by the tunnel.

In a chat, select **Connect** when ChatGPT offers the `jev` server. If ChatGPT
answers without calling the tool, ask it explicitly to use `jev.evaluate`. ChatGPT
may rephrase your question before sending it, which can change the probability.

A public Streamable HTTP endpoint (for clients without tunnel support) would need a
new entry point next to `src/transport/stdio.ts` and an authentication decision.
`createJevMcpServer` is transport-independent, so JEV Core, the provider and the
tools would not change.
