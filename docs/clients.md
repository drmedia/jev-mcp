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
| VS Code Copilot agent mode | stdio | Verified end to end (2026-10-07, VS Code 1.139); uses `.vscode/mcp.json` |
| Claude Desktop | stdio | Verified end to end (2026-10-07, Windows) |
| ChatGPT | stdio via Secure MCP Tunnel | Verified end to end (2026-10-07, tunnel-client 0.0.16) |
| Claude Code | Streamable HTTP (local) | Verified end to end (2026-10-07, Claude Code 2.1.289) |
| Codex CLI | Streamable HTTP (local) | Verified end to end (2026-10-07, codex-cli 0.160.0) |
| VS Code Copilot agent mode | Streamable HTTP (local) | Verified end to end (2026-10-07, VS Code 1.139.1); user `mcp.json` with a password input |

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

VS Code may start the server as soon as the folder opens and keeps it running. After
`npm run build`, run `MCP: List Servers`, select `jev`, then **Restart Server** so
Copilot uses the new build.

## Streamable HTTP (local)

stdio is the simplest choice: each client starts its own server. The HTTP entry
point instead runs one server process that several clients on this machine share.
It listens only on `127.0.0.1` and every request needs a bearer token.

### 1. Create a token

The token must be at least 32 characters. Generate one and put it in `.env` as
`JEV_HTTP_TOKEN`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Treat it like an API key: never commit it or paste it into chats.

### 2. Start the server

```bash
npm run build
npm run start:http
```

To run it in Docker instead, so it restarts by itself, use `docker compose up -d
--build` (see [README: Docker](../README.md#docker)); clients connect the same way.
The scripts below report port 8098 as taken while the container runs.

On Windows, double-click `scripts\start-http-server.cmd` instead: it builds once if
needed and runs the server in its own window, and refuses to start a second copy.
`scripts\stop-http-server.cmd` stops a server on port 8098, and only if it is a
`node` process. Both scripts assume the default port. Windows only lets you stop a
server you started yourself: if it was started by another user or from an elevated
window, the stop script reports "access denied"; close the server's window or run the
script as administrator.

It prints `Listening on http://127.0.0.1:8098/mcp`. Set `PORT` to use another port.
Stop it with Ctrl+C. After `npm run build`, restart it; clients reconnect on their
next request.

### 3. Connect a client

Claude Code (the header is stored in Claude Code's configuration):

```bash
claude mcp add --transport http jev-http http://127.0.0.1:8098/mcp \
  --header "Authorization: Bearer <JEV_HTTP_TOKEN>"
```

Codex CLI reads the token from an environment variable, so it is not stored in the
config file:

```bash
codex mcp add jev-http --url http://127.0.0.1:8098/mcp --bearer-token-env-var JEV_HTTP_TOKEN
```

Set `JEV_HTTP_TOKEN` in the environment Codex runs in.

VS Code Copilot: run `MCP: Open User Configuration` and add the server with a
password input, so the token is not written to the file:

```json
{
  "inputs": [
    { "type": "promptString", "id": "jev-http-token", "description": "JEV_HTTP_TOKEN", "password": true }
  ],
  "servers": {
    "jev-http": {
      "type": "http",
      "url": "http://127.0.0.1:8098/mcp",
      "headers": { "Authorization": "Bearer ${input:jev-http-token}" }
    }
  }
}
```

Start it from `MCP: List Servers`; VS Code asks for the token once and stores it.
Paste only the token value, without `JEV_HTTP_TOKEN=` or quotes; a wrong value gets
401, after which VS Code also probes for OAuth metadata that this server does not
offer.

VS Code logs `Tool "jev.noul" is invalid. Tools names may only contain [a-z0-9_-]`
for every tool. This is only a warning: VS Code replaces the dot and exposes the tool
as `jev_noul` (for example `mcp_jev-mcp_jev_score`), while calls still use the
original name. Reference tools in chat as `#jev_noul`, not `#jev.noul`. The MCP
specification allows dots in tool names.

Other clients need a Streamable HTTP URL and a way to send the
`Authorization: Bearer` header. Clients that only support OAuth cannot connect yet.

### What the server rejects

| Request | Response |
| --- | --- |
| Missing or wrong token, or a token in the URL | 401 |
| `Host` other than `127.0.0.1`, `localhost` or `[::1]` with the server's port | 403 |
| `Origin` present and not a loopback origin for the port | 403 |
| `GET` or `DELETE` (no event stream, no sessions) | 405 |
| Body over 32 MiB | 413 |
| Any path other than `/mcp` | 404 |

## After rebuilding

Every client keeps its own server process. After `npm run build`, restart the server
in each client you use: restart Claude Code or Claude Desktop, restart the server from
`MCP: List Servers` in VS Code, and stop and start `tunnel-client run` for ChatGPT.

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
