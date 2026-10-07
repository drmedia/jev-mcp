# jev-mcp

A general-purpose MCP server for System One decision models such as
[TypeSafe Jev](https://docs.typesafe.ai) and Cloudflare Clef. It lets MCP clients ask
typed questions (yes/no, choice, score) about structured state and get back
calibrated probabilities.

```text
MCP client → stdio → MCP tools → JEV Core → JevProvider → TypeSafe API or OpenRouter
```

See [AGENTS.md](AGENTS.md) for architecture and development rules,
[docs/typesafe-api-notes.md](docs/typesafe-api-notes.md) and
[docs/openrouter-notes.md](docs/openrouter-notes.md) for the verified API contracts,
and [CHANGELOG.md](CHANGELOG.md) for release history.

## Requirements

- Node.js 20.12 or later
- A TypeSafe API key, or an OpenRouter API key

## Setup

```bash
npm install
cp .env.example .env   # then set the key for your provider in .env
npm run build
```

| Variable | Required | Default |
| --- | --- | --- |
| `JEV_PROVIDER` | no | `typesafe` (or `openrouter`, `local`) |
| `TYPESAFE_API_KEY` | when `JEV_PROVIDER=typesafe` | — |
| `TYPESAFE_BASE_URL` | no | `https://api.typesafe.ai` |
| `OPENROUTER_API_KEY` | when `JEV_PROVIDER=openrouter` | — |
| `OPENROUTER_BASE_URL` | no | `https://openrouter.ai/api` (API root, without `/v1`) |
| `JEV_LOCAL_BASE_URL` | no | `http://127.0.0.1:8097` (server root, without `/v1`) |
| `JEV_LOCAL_API_KEY` | no | unset: no Authorization header |
| `JEV_MODEL` | no | `jev-latest` |
| `JEV_MAX_RETRIES` | no | `2` (0 to 10; 0 disables retries) |
| `JEV_IMAGE_DIRS` | no | unset: image `path` disabled. Absolute directories, separated by `;` on Windows and `:` elsewhere |
| `JEV_MAX_INPUT_CHARS` | no | `256000` characters of `state` plus `questions` per request; `0` disables |
| `JEV_MAX_CONCURRENCY` | no | `4` (1 to 16) provider requests at a time in `jev.evaluate_batch` |

## Checks before sending

Requests the server can tell will fail, or will be billed for nothing useful, are
stopped before they reach the provider:

| Check | Why |
| --- | --- |
| Text input over `JEV_MAX_INPUT_CHARS` | Clef accepted and billed inputs far beyond its documented context (118k tokens). 256,000 characters is about 64k tokens of English; text in Korean and similar scripts uses more tokens per character, so lower the limit if most input is such text |
| Images to a model that cannot read them | Jev answers images with confident wrong results and bills them as text |
| Clef rules: question IDs (letters, digits, `_` `.` `-`), 2 to 255 choice options, at most 64 questions, about 384 KB of images per request | Clef returns 422 or 413 otherwise; the local message names the problem |
| Image count, format and size limits | See [Images](#images) |

Requests the provider rejects were not billed in testing, so these checks mainly
prevent wasted spending on accepted requests and give clearer errors. Details:
[docs/openrouter-notes.md](docs/openrouter-notes.md#billing-of-rejected-requests).

The stdio server loads `.env` from the package root when present. Variables already
set by the MCP client or shell take precedence.

## Providers

`JEV_PROVIDER` selects one provider. It never switches to another provider on its
own, and a missing key for the selected provider is a configuration error.

| `JEV_PROVIDER` | Models (`JEV_MODEL`) | Cost in results |
| --- | --- | --- |
| `typesafe` (default) | `jev-latest`, `jev-preview`, `jev-1.13.0` | not reported |
| `openrouter` | `cloudflare/clef`, `cloudflare/clef-flash`, `typesafe/jev-1.13`, `jev-latest`, `openai/gpt-6-luna-decisions` (public beta) | `usage.costUsd` |
| `local` | Whatever your local System One server serves, for example `clef-flash` with llama.cpp | not reported (no per-request cost) |

`JEV_PROVIDER=local` uses a server on your own machine or network: no data leaves it.
Setup with llama.cpp and Clef Flash, and measured results:
[docs/local-provider.md](docs/local-provider.md).

On OpenRouter, Clef needs its full ID (`cloudflare/clef-flash`, not `clef-flash`),
accepts at most 64 questions per request, and Jev's context is 32k tokens instead of
64k. `jev.models` lists the decision models OpenRouter exposes. Details:
[docs/openrouter-notes.md](docs/openrouter-notes.md).

`openai/gpt-6-luna-decisions` is OpenAI's Decisions API, in public beta since
2026-10-06 ("we expect to GA in the coming weeks"), so its behavior may change. It
reads images and accepts long inputs, but it can refuse a question on content-policy
grounds, which fails the whole request; the server reports that as `refused` and does
not retry. Do not rely on it for production decisions before general availability.

Models differ in how confident they are. In testing Clef reported lower `confidence`
than Jev, and GPT-6 Luna mostly returned probabilities of 0 or 1, so set thresholds
per model from labeled examples.

## Images

Every question tool (`jev.evaluate`, `jev.noul`, `jev.choice`, `jev.score`) takes an
optional `images` list, judged together with `state`. Images are not tied to any use
case: inspection photos, site photos, screenshots and documents all go through the
same field.

```json
{
  "state": { "line": "B", "note": "Customer return" },
  "instructions": "Does the part in the photo show a visible defect?",
  "images": [
    { "path": "D:/inspections/2026-10-07/part-0412.jpg" },
    { "data": "data:image/png;base64,iVBORw0KGgo..." }
  ]
}
```

| Source | Use | Rule |
| --- | --- | --- |
| `path` | Agents on the same machine (Claude Code, Codex, VS Code) | Absolute path inside a `JEV_IMAGE_DIRS` directory; disabled when unset |
| `data` | Programs that already hold the bytes | Base64 data URL |

Before anything is sent, JEV Core checks that there are at most 4 images, that each
is PNG, JPEG or WebP (from the bytes, not the name), and that each is at most 4 MiB
with 8 MiB in total. Image parts placed inside `state` are rejected.

For Clef through OpenRouter the practical limit is much lower than Clef documents:
requests with more than about 384 KB of images in total fail there (measured, not
documented), so they are rejected before sending. Downscale or recompress photos
first; a 1024-pixel JPEG is usually well under the limit. GPT-6 Luna accepted a
624 KB photo.

Only image-capable models receive images: today `cloudflare/clef`,
`cloudflare/clef-flash` and `openai/gpt-6-luna-decisions` with
`JEV_PROVIDER=openrouter`, and local models the server lists with an `image` input
(for example Clef Flash in llama.cpp with `--mmproj`, which cannot load WebP).
Requests with images to any
other model, including Jev, fail before they are sent, because Jev answers images
with meaningless probabilities instead of an error. Details:
[docs/openrouter-notes.md](docs/openrouter-notes.md#images).

`JEV_IMAGE_DIRS` exists because the tools are called by AI agents: content an agent
reads could ask it to send a private file. Only files inside the listed directories
(resolved through symbolic links) can be read.

## Clients

Verified with Claude Code, Codex CLI and ChatGPT (through OpenAI's Secure MCP
Tunnel). Setup for each client, plus VS Code and Claude Desktop:
[docs/clients.md](docs/clients.md).

## Retries

The stdio server wraps the provider in `RetryingJevProvider`, which retries
transient failures: rate limiting (429), overload (529), timeouts (including 408 and
OpenRouter's 524), HTTP 500/502/503/504 and network errors such as DNS failures.
Authentication, authorization, insufficient credits (402), invalid requests and
invalid responses are never retried.

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

### `jev.evaluate_batch`

Asks the same `questions` about many `items` (up to 100) in one tool call: classify
a list of tickets with a choice question, or score every search result and sort by
the score. Each item has its own `state`, optional `id` and optional `images`;
`questions` and `model` work as in `jev.evaluate`.

```json
{
  "items": [
    { "id": "t1", "state": "My payout failed again." },
    { "id": "t2", "state": "The app crashes when I log in." }
  ],
  "questions": {
    "team": {
      "type": "choice",
      "instructions": "Which team should handle this ticket?",
      "criteria": { "billing": "Payments, refunds", "technical": "Bugs, outages" }
    }
  }
}
```

The System One APIs take one `state` per request, so each item is a separate
provider request and is billed separately. At most `JEV_MAX_CONCURRENCY` requests
run at the same time.

- Every item is checked before anything is sent; one invalid item rejects the call.
- `results` come back in input order, each with `status` `ok` (with `answers` and
  `usage`), `error` (the item's own error), or `skipped`.
- After `authentication`, `authorization`, `payment_required` or `configuration`
  errors, items not yet sent are `skipped`, because they would fail the same way.
- `summary` counts each status; `usage` adds up the successful items, with
  `costUsd` only when every successful item reported one.

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

GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs
`typecheck`, `test` and `build` on Node 20 and 22 for every push to `main` and every
pull request. It needs no secrets. The contract and e2e suites call the real API and
are run locally with a key.
