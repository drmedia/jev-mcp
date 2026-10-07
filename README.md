# jev-mcp

A general-purpose MCP server for [TypeSafe Jev](https://docs.typesafe.ai). It lets MCP
clients ask typed questions (yes/no, choice, score) about structured state and
get back calibrated probabilities.

```text
MCP client → stdio → MCP tools → JEV Core → JevProvider → TypeSafeProvider → TypeSafe Jev API
```

See [AGENTS.md](AGENTS.md) for architecture and development rules, and
[docs/typesafe-api-notes.md](docs/typesafe-api-notes.md) for the verified API contract.

## Requirements

- Node.js 20.12 or later
- A TypeSafe API key

## Setup

```bash
npm install
cp .env.example .env   # then set TYPESAFE_API_KEY in .env
npm run build
```

| Variable | Required | Default |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | yes | — |
| `TYPESAFE_BASE_URL` | no | `https://api.typesafe.ai` |
| `JEV_MODEL` | no | `jev-latest` |

The stdio server loads `.env` from the package root when present. Variables already
set by the MCP client or shell take precedence.

## Clients

Verified with Claude Code, Codex CLI and ChatGPT (through OpenAI's Secure MCP
Tunnel). Setup for each client, plus VS Code and Claude Desktop:
[docs/clients.md](docs/clients.md).

## Use with Claude Code

This repository includes a project-scoped [.mcp.json](.mcp.json) that starts
`dist/transport/stdio.js`. After `npm run build`, start Claude Code in the repository
root and approve the `jev` server when prompted. Check it with `/mcp`.

Claude Code exposes the tools as `mcp__jev__jev_evaluate` and `mcp__jev__jev_models`
(dots in tool names become underscores).

To use the server from another project, register it with an absolute path:

```bash
claude mcp add jev -- node /absolute/path/to/jev-mcp/dist/transport/stdio.js
```

## Tools

### `jev.evaluate`

Evaluates `state` against a map of `questions` in one provider request.

```json
{
  "state": "Help! My payouts have been failing for 3 days.",
  "questions": {
    "is_urgent": { "type": "noul", "instructions": "Does this convey urgency?" },
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this?",
      "criteria": { "billing": "Payments, refunds", "technical": "Bugs, outages" }
    },
    "frustration": {
      "type": "score",
      "instructions": "How frustrated is the customer?",
      "criteria": ["Calm", "Frustrated", "Very angry"]
    }
  }
}
```

The result has `model`, `answers` (keyed by question ID) and `usage`. Failures come
back as tool errors with a `kind` such as `invalid_input`, `authentication`,
`rate_limited` or `invalid_response`. No answer is ever fabricated.

### `jev.models`

Lists the model names and aliases the provider accepts in `model`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Type-check sources and tests |
| `npm test` | Unit tests (no API key needed) |
| `npm run build` | Compile to `dist/` |
| `npm run test:contract` | Provider tests against the real TypeSafe API (uses `.env`) |
| `npm run test:e2e` | Build, then drive the stdio server over MCP against the real API |
| `npm start` | Start the stdio server |
