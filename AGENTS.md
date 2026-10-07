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

- batch evaluation
- provider abstraction
- local JEV-compatible providers
- OpenRouter integration
- retries and backoff
- concurrency control
- telemetry
- usage and cost metadata
- authentication
- Streamable HTTP transport
- Docker deployment
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

Future providers may include:

```text
OpenRouterProvider
LocalProvider
MockProvider
JevCompatibleProvider
```

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

Future:

```text
jev.choice
jev.score
jev.noul
```

These are convenience wrappers.

They must delegate to the same evaluation path used by `jev.evaluate`.

Do not create separate TypeSafe API implementations for each convenience tool.

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
JEV_MODEL
```

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

Future implementation should support:

- maximum retry count
- exponential backoff
- timeout/deadline
- cancellation

Do not implement retries until requested in the relevant phase.

---

## 16. Configuration

Configuration must be centralized.

Recommended environment variables:

```text
TYPESAFE_API_KEY
TYPESAFE_BASE_URL
JEV_MODEL
```

Future configuration may include:

```text
JEV_PROVIDER
JEV_TIMEOUT_MS
JEV_MAX_RETRIES
JEV_MAX_CONCURRENCY
JEV_LOG_LEVEL
PORT
```

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

### Contract tests

Later, optionally run against the real TypeSafe API when:

```text
TYPESAFE_API_KEY
```

is explicitly available.

Real API tests must be separable from normal CI tests.

---

## 18. Mocking

Do not hard-code provider mock behavior inside production classes.

Use dependency injection or mock providers.

Recommended future test provider:

```text
MockJevProvider
```

This should implement the same provider interface as TypeSafeProvider.

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

---

## 26. Out of Scope for Initial MVP

Do not add these unless explicitly requested:

- CBM business rules
- equipment-specific logic
- RAG
- GraphRAG
- maintenance history
- rule engines
- OpenRouter
- local inference
- automatic provider fallback
- OAuth
- Docker/Kubernetes
- caching
- OpenTelemetry
- calibration/backtesting
- human review workflow
- multi-tenant support

These are future phases.

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