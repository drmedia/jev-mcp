# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Before 1.0.0, minor versions may
include breaking changes.

## [Unreleased]

Phase 9 defined in AGENTS.md.

### Added

- `jev.evaluate_batch`: the same questions about up to 100 items in one tool call,
  for general-purpose classification and ranking. One provider request per item,
  since the System One APIs take one `state` per request; every item is checked
  before anything is sent; per-item results in input order with `ok`, `error` or
  `skipped`; usage totals over successful items, with a cost only when every
  successful item reported one.
- `JEV_MAX_CONCURRENCY` (default 4, 1 to 16): provider requests a batch runs at the
  same time.
- MIT license (`LICENSE`); `package.json` now declares `MIT` instead of the npm default `ISC`.
- `JEV_TIMEOUT_MS` (default 30000, 1000 to 600000): time limit for each provider
  request attempt, previously fixed at 30 seconds.
- `JEV_LOG_LEVEL` (`error`, `warn` default, `info`, `debug`): `info` adds a startup
  line with the settings, `debug` adds one line per provider request with duration,
  outcome and tokens. Neither includes keys, base URLs, state or question text.
- When a provider response is invalid, its payload (up to 2,000 characters) is logged
  to stderr at `warn`, so the cause can be diagnosed. The tool result still carries
  only the error message.

### Changed

- Log lines include their level: `[jev-mcp] warn: ...` instead of `[jev-mcp] ...`.
- `createJevMcpServer` takes an optional `{ logger }`; `createProvider` takes an
  optional `{ timeoutMs }`; `JevCore` takes an optional `logger`.

## [0.3.0] - 2026-10-07

Completes Phases 7 and 8 defined in [AGENTS.md](AGENTS.md): general-purpose image
input, checks before sending, GPT-6 Luna Decisions, and a local provider.

### Added

- Optional `images` on every question tool (`jev.evaluate`, `jev.noul`,
  `jev.choice`, `jev.score`), from base64 data URLs (`data`) or local files
  (`path`). General-purpose: not tied to any use case.
- `JEV_IMAGE_DIRS`: image paths are read only inside these directories, resolved
  through symbolic links; unset disables image paths.
- Validation before any provider call: at most 4 images, PNG/JPEG/WebP detected from
  the bytes, 4 MiB each and 8 MiB in total.
- OpenRouter sends images to image-capable models (`cloudflare/clef`,
  `cloudflare/clef-flash`, `openai/gpt-6-luna-decisions`) as image parts in `state`,
  verified against the live API.
- `openai/gpt-6-luna-decisions` (OpenAI's Decisions API, public beta) is supported
  through OpenRouter and verified live for text, images and refusals.
- `JEV_PROVIDER=local` with `LocalProvider`: a System One-compatible server on your
  own machine or network (`JEV_LOCAL_BASE_URL`, default `http://127.0.0.1:8097`;
  optional `JEV_LOCAL_API_KEY`). Verified with llama.cpp `llama-server` serving Clef
  Flash (Q4_K_M) on an RTX 4070 Ti, for text and images. Images go in the server's
  `images` field; WebP is rejected before sending for llama-server, which cannot load it.
- `JEV_MAX_INPUT_CHARS` (default 256,000): text input above the limit is rejected
  before sending, because Clef accepted and billed inputs far beyond its documented
  context.
- Clef's request rules are checked before sending, with a message naming the
  problem: question IDs of letters, digits, `_`, `.`, `-`; 2 to 255 choice options;
  at most 64 questions; and at most 384,000 bytes of images per request, the limit
  measured through OpenRouter (far below Clef's documented 4 MiB per image).
- `refused` error kind: a model refusal (OpenRouter HTTP 502 "refused to answer
  question") is reported with the question and not retried.
- docs/openrouter-notes.md records the measured image limit, a small real-photo
  check, request-level differences between Jev, Clef and GPT-6 Luna, and that
  rejected requests were not billed.
- docs/local-provider.md: llama.cpp and Clef Flash setup with SHA-256 checksums, the
  required `--ubatch-size`, and measured local vs cloud results.
- Local contract and e2e tests run only when a local server is reachable.

### Security

- Requests with images are rejected before sending unless the provider lists the
  model with an `image` input. Jev answers images with HTTP 200 and confident wrong
  probabilities, so it must never receive one. The TypeSafe provider rejects images.
- Image parts placed inside `state` are rejected, so images cannot bypass validation
  and the model capability check.

### Changed

- HTTP 413 maps to `invalid_request` instead of `provider_error`.
- Error messages show the reason when the provider sends only an error type (TypeSafe
  `max_tokens_exceeded`) or relays an upstream error inside OpenRouter's message.
- OpenRouter model discovery follows the documented `Model` schema: `description` is
  optional and `input_modalities` is required.
- `jev.models` entries have optional `description` and `releaseDate`, omitted when a
  provider does not report them instead of being invented.
- The HTTP client sends no Authorization header when no key is configured.

## [0.2.0] - 2026-10-07

Completes Phase 6 defined in [AGENTS.md](AGENTS.md).

### Added

- `OpenRouterProvider` for OpenRouter's System One API, verified with
  `cloudflare/clef`, `cloudflare/clef-flash` and `typesafe/jev-1.13`.
- `JEV_PROVIDER` (`typesafe` by default, or `openrouter`), `OPENROUTER_API_KEY` and
  `OPENROUTER_BASE_URL`. Selection is strict: no automatic fallback between
  providers, and the selected provider's key is required.
- `jev.models` lists OpenRouter's decision models when OpenRouter is selected.
- `usage.costUsd` in results when the provider reports a cost (OpenRouter does;
  TypeSafe does not). Costs are never estimated locally.
- `payment_required` error kind for HTTP 402 (insufficient credits); OpenRouter's
  524 maps to `timeout`.
- Contract and e2e tests for OpenRouter; [docs/openrouter-notes.md](docs/openrouter-notes.md)
  records its observed behavior.

### Changed

- The HTTP client and System One response handling are shared by both providers.
  Error messages name the provider that failed (`TypeSafe API ...`,
  `OpenRouter API ...`).
- OpenRouter error details keep only the error code and message; other fields such
  as `user_id` are dropped.

## [0.1.0] - 2026-10-07

First release. Completes MVP phases 1-5 defined in [AGENTS.md](AGENTS.md).

### Added

- `TypeSafeProvider` for `GET /v1/models` and `POST /v1/systemone`, with response
  validation and error mapping by kind (`authentication`, `invalid_request`,
  `rate_limited`, `overloaded`, `timeout`, `network`, `invalid_response`, and more).
- `JevCore`: input validation, default model, and checks that every provider answer
  matches the question asked. Answers are never fabricated or adjusted.
- MCP tools over stdio: `jev.evaluate`, `jev.models`, and the single-question
  convenience tools `jev.noul`, `jev.choice` and `jev.score`, all on the same
  `JevCore.evaluate` path.
- `RetryingJevProvider`: bounded retries with exponential backoff and jitter for
  transient failures; honors `retry-after`; configurable with `JEV_MAX_RETRIES`.
- Network errors include the underlying cause (for example `ENOTFOUND`).
- Client setup verified end to end for Claude Code (CLI and VS Code), Codex CLI,
  ChatGPT (through OpenAI Secure MCP Tunnel), Claude Desktop and VS Code Copilot
  agent mode. See [docs/clients.md](docs/clients.md).
- Contract tests pin the three observed differences between the TypeSafe
  documentation and the live API. See
  [docs/typesafe-api-notes.md](docs/typesafe-api-notes.md).
- GitHub Actions CI: typecheck, unit tests and build on Node 20 and 22.

[Unreleased]: https://github.com/drmedia/jev-mcp/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/drmedia/jev-mcp/releases/tag/v0.3.0
[0.2.0]: https://github.com/drmedia/jev-mcp/releases/tag/v0.2.0
[0.1.0]: https://github.com/drmedia/jev-mcp/releases/tag/v0.1.0
