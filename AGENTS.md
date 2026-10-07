# JEV MCP Development Guide

## 1. Project Goal

Build a general-purpose MCP server for TypeSafe Jev.

The server should eventually work with:

- Claude
- Claude Code
- ChatGPT
- Codex
- VS Code agents
- other MCP-compatible clients

This repository contains the general-purpose JEV integration layer.

Do not add CBM-specific, manufacturing-specific, safety-specific, or other domain-specific business logic to the core.

Domain-specific functionality should be implemented later as separate adapters or packages.

---

## 2. Primary Development Agents

This repository is developed using both:

- Claude Code
- OpenAI Codex

All agents must follow this file as the shared source of project development instructions.

Do not create competing architectures or conventions depending on which agent is working on the repository.

Before modifying the project:

1. Read this `AGENTS.md`.
2. Inspect the existing implementation.
3. Preserve existing architecture unless there is a clear reason to change it.
4. Check current tests before making large changes.
5. Do not rewrite working components unnecessarily.

---

## 3. Architecture

The core architecture is:

```text
MCP Client
    ↓
MCP Tool Layer
    ↓
JEV Core
    ↓
Provider Interface
    ↓
TypeSafe Provider
    ↓
TypeSafe Jev API
```

The provider layer now has three implementations behind the same interface: `TypeSafeProvider` (TypeSafe Jev API), `OpenRouterProvider` (OpenRouter's System One API, Phase 6) and `LocalProvider` (a System One-compatible server on the user's machine, Phase 8). `RetryingJevProvider` wraps the selected provider and adds bounded retries. `JEV_PROVIDER` selects the provider.

The following layers must remain separated:

- MCP transport
- MCP tool definitions
- input/output schemas
- JEV core logic
- provider interfaces
- provider implementations
- configuration
- observability
- tests

Do not call the TypeSafe API directly from MCP tool handlers.

Correct:

```text
MCP Tool
    ↓
JEV Core
    ↓
Provider
```

Avoid:

```text
MCP Tool
    ↓
fetch(TypeSafe API)
```

---

## 4. Initial Scope

The first MVP contains only:

- `jev.evaluate`
- `jev.models`

`jev.evaluate` is the canonical JEV decision interface.

After the core implementation is stable, convenience tools may be added:

- `jev.choice`
- `jev.score`
- `jev.noul`

These tools should reuse the same JEV Core implementation rather than duplicate provider logic.

Later phases may include:

- batch evaluation (implemented: Phase 9, `jev.evaluate_batch`)
- provider abstraction (implemented: `JevProvider`)
- local JEV-compatible providers (implemented: Phase 8, `LocalProvider`)
- OpenRouter integration (implemented: Phase 6, `OpenRouterProvider`)
- retries and backoff (implemented: `RetryingJevProvider`)
- concurrency control (implemented for batches: Phase 9, `JEV_MAX_CONCURRENCY`)
- telemetry
- usage and cost metadata (implemented: token usage, and cost when the provider reports it)
- provider selection per request (implemented: Phase 12, `JEV_PROVIDERS` and `provider`)
- authentication (implemented for local HTTP: Phase 10, bearer token; OAuth is future)
- Streamable HTTP transport (implemented locally: Phase 10, `src/transport/http.ts`; remote deployment is future)
- Docker deployment (implemented locally: Phase 11, `Dockerfile` and `compose.yaml`; registry publishing and cloud deployment are future)
- calibration utilities
- domain adapters

Do not implement future-phase features unless the current task explicitly requests them.

---

## 5. Technology

Use:

- Node.js 20+
- TypeScript
- current stable MCP TypeScript SDK
- Zod
- Vitest

Prefer strict TypeScript configuration.

Avoid `any` unless interaction with an external untyped payload requires it.

When `unknown` can be safely validated, prefer `unknown` over `any`.

---

## 6. MCP Compatibility

The MCP implementation should be designed for compatibility with:

- Claude Code
- Claude
- ChatGPT
- Codex
- other standards-compliant MCP clients

The initial local development transport is:

```text
stdio
```

Later production transport should support:

```text
Streamable HTTP
```

Streamable HTTP is implemented for local use (Phase 10): `src/transport/http.ts` listens on `127.0.0.1` only, statelessly, with a bearer token. Both entry points share `src/transport/runtime.ts`, so they serve identical tools.

Do not build new functionality around deprecated SSE-only transport.

Transport code must remain separate from JEV Core.

---

## 7. TypeSafe Jev Integration

Default base URL:

```text
https://api.typesafe.ai
```

Current integration targets include:

```text
GET /v1/models
POST /v1/systemone
```

Authentication is provided through:

```text
Authorization: Bearer <TYPESAFE_API_KEY>
```

Before implementing or changing provider request/response schemas:

1. Verify the current official TypeSafe documentation.
2. Verify the current OpenAPI schema when available.
3. Do not rely only on previous chat messages, README examples, or assumptions.
4. Do not invent undocumented response fields.

In particular, never assume undocumented structures for:

- Choice
- Score
- Noul
- probabilities
- confidence
- usage
- token counts
- costs
- model metadata

If the external API behavior and documentation disagree, document the discrepancy and add a contract test where practical.

The same rules apply to every provider: OpenRouter's System One and model APIs, and the documented API of local servers such as llama.cpp `llama-server`. Discrepancies are recorded in `docs/typesafe-api-notes.md`, `docs/openrouter-notes.md` and `docs/local-provider.md`.

---

## 8. Provider Architecture

Define a provider-neutral interface.

Conceptually:

```typescript
interface JevProvider {
  models(): Promise<unknown>;
  evaluate(request: JevEvaluateRequest): Promise<JevEvaluateResult>;
}
```

The first implementation is:

```text
TypeSafeProvider
```

Implemented providers:

```text
TypeSafeProvider
OpenRouterProvider   (Phase 6)
LocalProvider        (Phase 8, any System One-compatible server)
```

`RetryingJevProvider` is a decorator around any provider, not a provider of its own.

`MockJevProvider` in `tests/support/mock-provider.ts` implements the interface for tests only.

Future providers may include other JEV-compatible APIs. Add them behind the same interface.

Core code must not depend directly on `TypeSafeProvider`.

Depend on the provider interface.

---

## 9. MCP Tools

### jev.evaluate

This is the canonical tool.

Conceptually:

```text
State
+
Questions
    ↓
jev.evaluate
    ↓
JEV Core
    ↓
Provider
```

The tool should support multiple JEV questions in one provider request when the underlying API supports it.

Do not manufacture missing results.

Do not convert provider errors into fake probability values.

---

### jev.models

Returns models exposed by the configured provider.

Do not hard-code the available model list when the provider supplies a model discovery endpoint.

---

### Convenience Tools

Implemented:

```text
jev.choice
jev.score
jev.noul
```

These are convenience wrappers.

They must delegate to the same evaluation path used by `jev.evaluate`.

Do not create separate TypeSafe API implementations for each convenience tool.

---

### jev.evaluate_batch

Asks the same questions about many items (Phase 9), for general-purpose classification and ranking.

It must reuse the same JEV Core evaluation path as `jev.evaluate`, one provider request per item, because the System One APIs accept one state per request.

Prefer this tool over adding task-specific tools (for example classify or rerank) that only rephrase `noul`, `choice` or `score` questions.

---

## 10. Input Validation

Validate all externally supplied MCP tool inputs.

Use Zod schemas where appropriate.

Reject:

- malformed question definitions
- missing required fields
- invalid numeric ranges
- invalid model identifiers where validation is possible
- unsupported question structures

Validation failures should return clear actionable errors.

Do not silently modify malformed requests unless normalization is explicitly part of the documented behavior.

---

## 11. Provider Response Validation

Treat external API responses as untrusted input.

Where practical:

1. parse the response,
2. validate expected structure,
3. reject structurally invalid responses,
4. preserve useful raw provider information for diagnostics.

Never fabricate fields to make an invalid provider response appear valid.

---

## 12. Security

Never commit, print, expose, or return secrets.

The following must come from environment variables:

```text
TYPESAFE_API_KEY
TYPESAFE_BASE_URL
OPENROUTER_API_KEY
OPENROUTER_BASE_URL
JEV_LOCAL_BASE_URL
JEV_LOCAL_API_KEY
JEV_MODEL
JEV_HTTP_TOKEN
```

`TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, `JEV_LOCAL_API_KEY` and `JEV_HTTP_TOKEN` are secrets. A provider never falls back to another provider's key.

Never log:

- API keys
- Authorization headers
- cookies
- access tokens
- refresh tokens
- `.env` contents
- other secrets

Never add real credentials to:

- source code
- tests
- fixtures
- screenshots
- README examples
- issue templates

Use:

```text
.env.example
```

with empty placeholder values.

---

## 13. stdio Rules

When running as a stdio MCP server:

**stdout is reserved for MCP protocol traffic.**

Do not use:

```typescript
console.log(...)
```

for diagnostics in the stdio server process.

Use stderr or an appropriate logging abstraction.

A stray stdout log can break the JSON-RPC/MCP connection.

---

## 14. Error Handling

Preserve meaningful provider errors.

Distinguish where possible between:

- invalid configuration
- invalid MCP input
- authentication failure
- authorization failure
- provider rate limiting
- provider timeout
- network failure
- invalid provider response
- internal server error

Do not turn errors into fake JEV decisions.

Do not catch errors only to hide them.

---

## 15. Retry Policy

Do not automatically retry every failed request.

Retries may eventually be appropriate for transient conditions such as:

- HTTP 408
- HTTP 429
- selected 5xx responses
- transient network errors

Avoid automatic retry for:

- authentication errors
- invalid requests
- schema errors
- deterministic provider failures

Retry behavior must be bounded.

Implemented in `RetryingJevProvider`:

- retried: `rate_limited` (429), `overloaded`, `timeout`, `network`, and `provider_error` with HTTP 500, 502, 503 or 504
- never retried: every other error kind, including `refused`
- maximum retry count: `JEV_MAX_RETRIES` (default 2, 0 to 10)
- exponential backoff with full jitter, at most 8 seconds per wait; a provider `retry-after` of 8 seconds or less is honored, and a longer one ends retrying
- per-attempt timeout: `JEV_TIMEOUT_MS` (default 30 seconds)
- cancellation: a cancelled MCP request stops retries and waits

Change the retry policy only when a task explicitly requests it.

---

## 16. Configuration

Configuration must be centralized.

Implemented environment variables (defaults and ranges are in `README.md` and `.env.example`):

```text
JEV_PROVIDER
JEV_PROVIDERS
TYPESAFE_API_KEY
TYPESAFE_BASE_URL
OPENROUTER_API_KEY
OPENROUTER_BASE_URL
JEV_LOCAL_BASE_URL
JEV_LOCAL_API_KEY
JEV_MODEL
JEV_MAX_RETRIES
JEV_MAX_CONCURRENCY
JEV_IMAGE_DIRS
JEV_MAX_INPUT_CHARS
JEV_TIMEOUT_MS
JEV_LOG_LEVEL
JEV_HTTP_TOKEN   (HTTP entry point only)
JEV_HTTP_HOST    (HTTP entry point only; 0.0.0.0 only in containers)
PORT             (HTTP entry point only)
```

Every new variable must be added to `src/config/config.ts`, `.env.example` (empty value) and the README configuration table.

Do not scatter direct `process.env` reads throughout the codebase.

Use a configuration module.

---

## 17. Testing Strategy

Use Vitest.

Tests should be divided conceptually into:

```text
unit
integration
contract
e2e
```

MVP requires at least:

### Unit tests

- configuration parsing
- schemas
- provider request mapping
- provider response mapping
- error mapping

### Provider tests

Use mocked HTTP responses for normal unit tests.

Do not require a real TypeSafe API key for the standard test suite.

### Contract and e2e tests

Contract tests (`npm run test:contract`, `tests/contract/`) call the real APIs, and e2e tests (`npm run test:e2e`, `tests/e2e/`) run the built stdio server. Each test runs only when what it needs is available and skips otherwise:

```text
TYPESAFE_API_KEY      TypeSafe tests
OPENROUTER_API_KEY    OpenRouter tests
local server /health  local provider tests
```

Real API tests must be separable from normal CI tests. `npm test` and CI run only `tests/unit/`, which needs no keys.

---

## 18. Mocking

Do not hard-code provider mock behavior inside production classes.

Use dependency injection or mock providers.

Test provider (implemented in `tests/support/mock-provider.ts`):

```text
MockJevProvider
```

It implements the same provider interface as `TypeSafeProvider`. Use it in unit tests instead of mocking provider classes.

---

## 19. Coding Style

Prefer:

- small modules
- explicit types
- pure functions where practical
- dependency injection
- descriptive names
- early validation
- clear error messages

Avoid:

- giant service files
- deeply nested conditionals
- hidden global state
- duplicated provider logic
- unnecessary abstractions
- premature frameworks

Do not refactor unrelated working code while implementing a focused task.

---

## 20. Dependency Policy

Before adding a dependency:

1. check whether the project already has a suitable dependency,
2. determine whether the standard library can solve the problem cleanly,
3. prefer actively maintained packages,
4. avoid unnecessary dependencies.

Do not replace an existing dependency simply because another library is preferred by the current agent.

---

## 21. Git Practices

Before major work:

```text
git status
```

Inspect existing changes.

Do not overwrite unrelated user modifications.

Keep commits logically scoped when commits are requested.

Suggested branch naming:

```text
feature/...
fix/...
refactor/...
test/...
docs/...
```

Do not commit secrets.

---

## 22. Agent Collaboration

Claude Code and Codex may work on the same repository at different times.

Therefore:

- inspect existing code before editing,
- inspect `git diff`,
- do not assume another agent's work is disposable,
- preserve working tests,
- avoid wholesale rewrites,
- document architecture changes,
- leave the repository in a buildable state.

If an earlier implementation appears questionable, investigate before replacing it.

---

## 23. Task Workflow

For each implementation task:

1. Read `AGENTS.md`.
2. Inspect relevant files.
3. Understand the current implementation.
4. Check existing tests.
5. Make the smallest coherent change.
6. Add or update tests.
7. Run relevant tests.
8. Run typecheck.
9. Run build.
10. Review the diff.

Do not claim success unless the commands actually passed.

---

## 24. Required Validation

Before declaring an implementation complete, run:

```bash
npm run typecheck
npm test
npm run build
```

If one cannot run, state why.

Do not report a test as passed if it was not executed.

---

## 25. MVP Definition of Done

MVP Phase 1 is complete when:

```text
GET /v1/models
```

works through `TypeSafeProvider`.

MVP Phase 2 is complete when:

```text
POST /v1/systemone
```

works through the provider abstraction.

MVP Phase 3 is complete when:

```text
Claude Code
   ↓
MCP stdio
   ↓
jev.evaluate
   ↓
JEV Core
   ↓
TypeSafeProvider
   ↓
TypeSafe Jev
```

works end-to-end.

MVP Phase 4 is complete when the same MCP implementation can be prepared for additional MCP clients without changing JEV Core.

Phase 5 (stabilization and first release, `v0.1.0`) is complete when:

- every documented discrepancy between the TypeSafe documentation and the live API is pinned by a contract test,
- package metadata reflects a pre-1.0 release (`version` `0.1.0`, `private` to prevent accidental npm publishing, `repository`),
- `CHANGELOG.md` records the release,
- `main` passes CI, and the `v0.1.0` tag and GitHub release exist.

Phase 5 adds no new runtime features.

Phase 6 (OpenRouter provider, `v0.2.0`) is complete when:

- `JEV_PROVIDER` selects `typesafe` (default) or `openrouter`; unknown values and missing credentials are configuration errors, never silent fallbacks,
- `OpenRouterProvider` implements the provider interface through OpenRouter's System One API and is verified against the live API with `cloudflare/clef`, `cloudflare/clef-flash` and `typesafe/jev-1.13`,
- `jev.models` lists the decision models OpenRouter exposes,
- a per-request cost is returned only when the provider reports one; costs are never computed or estimated locally,
- provider-specific behavior is pinned by contract tests and documented,
- JEV Core logic and the MCP tool definitions are unchanged apart from the optional cost field and a `payment_required` error kind for HTTP 402,
- `main` passes CI, and the `v0.2.0` tag and GitHub release exist.

Phase 7 (general-purpose image input) is complete when:

- every question tool accepts an optional `images` list with the same format; images are not tied to any domain or use case,
- images come from base64 data URLs (`data`) or local files (`path`); `path` reads only files inside the directories listed in `JEV_IMAGE_DIRS` and is disabled when it is unset,
- images are validated before any provider call: at most 4, PNG, JPEG or WebP detected from the bytes, at most 4 MiB each and 8 MiB in total,
- a request with images is rejected before it is sent when the model is not known to accept images; a text-only model must never receive an image,
- image parts placed inside `state` are rejected so images only travel through `images`,
- image support is verified against the live API with an image-capable model (`cloudflare/clef` or `cloudflare/clef-flash` on OpenRouter),
- requests whose text input (`state` plus `questions`) exceeds `JEV_MAX_INPUT_CHARS` are rejected before sending, because some models accept and bill inputs beyond their documented context,
- requests that break a model's documented request rules (for Clef: question IDs, 2 to 255 choice options, at most 64 questions) are rejected before sending with a message naming the problem,
- a model refusal is reported as `refused` and is never retried,
- `main` passes CI.

Version bumps, tags and releases happen only when the project owner explicitly asks for them. Record unreleased changes under `## [Unreleased]` in `CHANGELOG.md` until then.

Phase 8 (local provider) is complete when:

- `JEV_PROVIDER=local` sends requests to a System One-compatible server on the user's machine or network (`JEV_LOCAL_BASE_URL`, optional `JEV_LOCAL_API_KEY`); no request leaves for a cloud service,
- the provider is verified against a live local server running a decision model (llama.cpp `llama-server` with Clef Flash),
- `jev.models` lists the decision models the local server reports, without inventing descriptions or release dates the server does not provide,
- images are sent only to models the local server reports as image-capable, in the format the server documents, and formats the server is known not to load are rejected before sending,
- the server itself stays outside this repository: setup is documented, not automated,
- contract and e2e tests for the local server run only when a local server is reachable,
- `main` passes CI.

Phase 9 (batch evaluation) is complete when:

- `jev.evaluate_batch` asks the same questions about up to 100 items in one tool call; each item has its own `state` and optional `images`, so general-purpose classification and ranking need no task-specific tools,
- every item is validated with the same checks as `jev.evaluate` before any request is sent; one invalid item rejects the whole batch,
- items go through the same JEV Core evaluation path and provider interface as `jev.evaluate`, one provider request per item, because neither the TypeSafe nor the OpenRouter System One API accepts several states in one request,
- at most `JEV_MAX_CONCURRENCY` item requests run at the same time (default 4),
- each item reports its own answers or its own error in input order; a failed item never receives fabricated answers and does not hide the results of other items,
- after an error that every remaining item would also hit (`configuration`, `authentication`, `authorization`, `payment_required`), the remaining items are not sent and are reported as skipped,
- total usage adds up the successful items only, and a total cost is reported only when every successful item reported one,
- `main` passes CI.

Phase 10 (local Streamable HTTP transport) is complete when:

- a second entry point, `src/transport/http.ts`, serves the same MCP tools over Streamable HTTP at `/mcp`, beside the unchanged stdio entry point; JEV Core, the tool definitions and the providers are unchanged,
- the transport follows the current MCP Streamable HTTP specification (2025-11-25) through the SDK's `StreamableHTTPServerTransport`, statelessly: POST carries JSON-RPC messages, and GET and DELETE return 405 because the server offers no SSE stream and no sessions,
- the server binds only to `127.0.0.1`, rejects requests whose `Host` is not a loopback name for its port, and rejects with 403 any request whose `Origin` header is present and is not a loopback origin for its port, to prevent DNS rebinding,
- every request must carry `Authorization: Bearer <JEV_HTTP_TOKEN>`; the token comes from the environment, must be at least 32 characters, is compared in constant time, is never logged, and a missing or wrong token gets 401; tokens in the URL query string are not accepted,
- `PORT` selects the port (default 8098), request bodies are limited in size, and configuration is read through the configuration module,
- the HTTP entry point is verified end to end with an MCP client over HTTP, and at least one real MCP client (Claude Code) calls the tools through it,
- OAuth, remote binding, TLS and cloud deployment remain out of scope; they belong to a later deployment phase,
- `main` passes CI.

Phase 11 (local Docker deployment) is complete when:

- a `Dockerfile` builds the Streamable HTTP server as a multi-stage image on a pinned official Node.js base image, with production dependencies only, running as a non-root user,
- `JEV_HTTP_HOST` lets the server listen on `0.0.0.0` inside a container only; it accepts `127.0.0.1` (the default) or `0.0.0.0`, and the `Host`, `Origin` and bearer token checks of Phase 10 stay in force either way,
- `compose.yaml` publishes the port on the host's `127.0.0.1` only, reads secrets from `.env` without baking them into the image, restarts the container unless it was stopped (so the server comes back after a sign-in or reboot once Docker Desktop runs), and checks health with an authenticated MCP request,
- `.dockerignore` keeps `.env`, `node_modules`, `dist`, tests and Git data out of the build context,
- the image is verified by building and running it with Compose and calling the tools from a real MCP client (Claude Code), and CI builds the image,
- cloud deployment, TLS, OAuth and publishing images to a registry remain out of scope,
- `main` passes CI.

Phase 12 (selectable providers) is complete when:

- `JEV_PROVIDERS` lists the providers one server may use (for example `typesafe,openrouter,local`); `JEV_PROVIDER` stays the default and is always included; every listed provider must have its own credentials, and a missing key is a configuration error, never a silent fallback or a key borrowed from another provider,
- unset `JEV_PROVIDERS` keeps today's behavior: one provider, and a key that happens to be present does not enable another provider,
- every question tool (`jev.evaluate`, `jev.evaluate_batch`, `jev.noul`, `jev.choice`, `jev.score`) accepts an optional `provider`; omitting it uses the default provider, and an unlisted name is rejected before any request with a message naming the available providers,
- `model` defaults to `JEV_MODEL` for the default provider and to `jev-latest` for TypeSafe or a local server when another provider is selected; for OpenRouter a `model` is required, because no default model can be assumed,
- results name the provider that answered, and `jev.models` lists the models of every configured provider, each tagged with its provider, reporting a provider that cannot be reached instead of hiding it or failing the whole list,
- JEV Core keeps depending only on the provider interface; providers, retries and pre-send checks are unchanged, and each provider keeps its own retry wrapper,
- the routing is verified against at least two live providers in one server process,
- `main` passes CI.

Phase 13 (client guidance) is complete when:

- the server sends MCP `instructions` in its initialize result, telling the calling AI which tool fits which task, how to write questions, how to read probabilities, how to choose a provider and model, and what to do for each error kind,
- the instructions are general-purpose (no domain or business rules) and are built from the server's configuration, so they name only the providers this server offers and its default,
- the instructions stay short enough for clients that add them to a system prompt, and never contain secrets, base URLs or local paths,
- `docs/usage.md` is the integration guide for developers: connection options (stdio, Streamable HTTP, Docker, ChatGPT tunnel), tool inputs and results, provider selection, error kinds, cost and choosing decision thresholds,
- at least one real MCP client is shown to receive the instructions,
- whenever tools, providers or error kinds change later, the instructions and `docs/usage.md` are updated in the same change,
- `main` passes CI.

---

## 26. Out of Scope for Initial MVP

Do not add these unless explicitly requested:

- CBM business rules
- equipment-specific logic
- RAG
- GraphRAG
- maintenance history
- rule engines
- automatic provider fallback
- OAuth
- Docker/Kubernetes
- caching
- OpenTelemetry
- calibration/backtesting
- human review workflow
- multi-tenant support

These are future phases.

OpenRouter (Phase 6) and local inference (Phase 8) were originally on this list and have since been implemented on request.

---

## 27. Core Principle

Keep the core general-purpose.

The project should remain conceptually:

```text
Structured State
+
Typed Questions
        ↓
     JEV MCP
        ↓
Probabilistic Decisions
```

Domain-specific meaning belongs outside JEV Core.


## Language Policy

All project content must be written in English.

This applies to:

- source code identifiers
- code comments
- documentation
- README files
- AGENTS.md
- CLAUDE.md
- test names
- test descriptions
- error messages
- log messages
- configuration comments
- Git branch names
- Git commit messages
- pull request titles and descriptions
- issue titles and descriptions
- release notes
- generated documentation

Do not add Korean text to the repository unless a task explicitly requires Korean localization or Korean test data.

When discussing implementation inside coding agents, use English for technical output and repository-facing content.

User-facing conversation outside the repository may use the user's preferred language, but all files and Git artifacts created for this project must remain English-only.