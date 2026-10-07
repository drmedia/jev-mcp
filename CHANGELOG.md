# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Before 1.0.0, minor versions may
include breaking changes.

## [Unreleased]

Phase 7 defined in [AGENTS.md](AGENTS.md).

### Added

- Optional `images` on every question tool (`jev.evaluate`, `jev.noul`,
  `jev.choice`, `jev.score`), from base64 data URLs (`data`) or local files
  (`path`). General-purpose: not tied to any use case.
- `JEV_IMAGE_DIRS`: image paths are read only inside these directories, resolved
  through symbolic links; unset disables image paths.
- Validation before any provider call: at most 4 images, PNG/JPEG/WebP detected from
  the bytes, 4 MiB each and 8 MiB in total.
- OpenRouter sends images to image-capable models (`cloudflare/clef`,
  `cloudflare/clef-flash`) as image parts in `state`, verified against the live API.
- Clef image requests above 384,000 bytes of images in total are rejected before
  sending: OpenRouter returns 413 above about that size for Clef (measured), far below
  Clef's documented 4 MiB per image. Other models are not held to this limit.
- `openai/gpt-6-luna-decisions` (OpenAI's Decisions API, public beta) is supported
  through OpenRouter and verified live for text, images and refusals.
- `refused` error kind: a model refusal (OpenRouter HTTP 502 "refused to answer
  question") is reported with the question and not retried.
- docs/openrouter-notes.md records the measured image limit, a small real-photo
  check, request-level differences between Jev and Clef, and that rejected requests
  were not billed.
- `JEV_MAX_INPUT_CHARS` (default 256,000): text input above the limit is rejected
  before sending, because Clef accepted and billed inputs far beyond its documented
  context.
- Clef's request rules (question IDs of letters, digits, `_`, `.`, `-`; 2 to 255
  choice options; at most 64 questions) are checked before sending, with a message
  naming the questions, instead of OpenRouter's nested 422.

### Security

- Requests with images are rejected before sending unless OpenRouter lists the model
  with an `image` input modality. Jev answers images with HTTP 200 and meaningless
  probabilities, so it must never receive one. The TypeSafe provider rejects images.
- Image parts placed inside `state` are rejected, so images cannot bypass validation
  and the model capability check.

### Changed

- HTTP 413 maps to `invalid_request` instead of `provider_error`.
- Error messages show the reason when the provider sends only an error type (TypeSafe
  `max_tokens_exceeded`) or relays an upstream error inside OpenRouter's message.
- OpenRouter model discovery follows the documented `Model` schema: `description` is
  optional (the model name is used instead) and `input_modalities` is required.

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

[Unreleased]: https://github.com/drmedia/jev-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/drmedia/jev-mcp/releases/tag/v0.2.0
[0.1.0]: https://github.com/drmedia/jev-mcp/releases/tag/v0.1.0
