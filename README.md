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
| `JEV_MAX_RETRIES` | no | `2` (0 to 10; 0 disables retries) |

The stdio server loads `.env` from the package root when present. Variables already
set by the MCP client or shell take precedence.

## Clients

Verified with Claude Code, Codex CLI and ChatGPT (through OpenAI's Secure MCP
Tunnel). Setup for each client, plus VS Code and Claude Desktop:
[docs/clients.md](docs/clients.md).

## Retries

The stdio server wraps the provider in `RetryingJevProvider`, which retries
transient failures: rate limiting (429), overload (529), timeouts (including 408),
HTTP 500/502/503/504 and network errors such as DNS failures. Authentication,
authorization, invalid requests and invalid responses are never retried.

Waits use exponential backoff with jitter (up to 0.5 s, then 1 s, 2 s, ..., capped
at 8 s). A `retry-after` header is honored when it is 8 s or less; a longer
requested wait ends retrying. Cancellation stops any pending wait. Each retry is
logged to stderr. After the last attempt, the original error is returned unchanged.

`POST /v1/systemone` is retried too. If a timed-out request was actually processed,
the retry is billed again.

## Use with Claude Code

This repository includes a project-scoped [.mcp.json](.mcp.json) that starts
`dist/transport/stdio.js`. After `npm run build`, start Claude Code in the repository
root and approve the `jev` server when prompted. Check it with `/mcp`.

Claude Code exposes the tools with dots replaced by underscores, for example
`mcp__jev__jev_evaluate` and `mcp__jev__jev_noul`.

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

### `jev.noul`, `jev.choice`, `jev.score`

Convenience tools for a single question. Each takes `state`, `instructions`, an
optional `model` and the question's `criteria` (optional for `jev.noul`), and
returns `{ model, answer, usage }`. They wrap the input in a one-question
`jev.evaluate` request and run it through the same JEV Core path, so validation,
answer checks and errors are identical.

```json
{
  "state": "Help! My payouts have been failing for 3 days.",
  "instructions": "Which team should handle this?",
  "criteria": { "billing": "Payments, refunds", "technical": "Bugs, outages" }
}
```

Use `jev.evaluate` to ask several questions about the same state: it answers them
in one request.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Type-check sources and tests |
| `npm test` | Unit tests (no API key needed) |
| `npm run build` | Compile to `dist/` |
| `npm run test:contract` | Provider tests against the real TypeSafe API (uses `.env`) |
| `npm run test:e2e` | Build, then drive the stdio server over MCP against the real API |
| `npm start` | Start the stdio server |
