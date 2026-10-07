# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Before 1.0.0, minor versions may
include breaking changes.

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

[0.2.0]: https://github.com/drmedia/jev-mcp/releases/tag/v0.2.0
[0.1.0]: https://github.com/drmedia/jev-mcp/releases/tag/v0.1.0
