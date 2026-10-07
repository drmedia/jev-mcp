# Integration guide

How another application uses jev-mcp: connecting, asking questions, choosing a
provider, handling errors and turning probabilities into decisions. Setup details
for each client are in [clients.md](clients.md); configuration is in the
[README](../README.md#setup).

## What the server does

jev-mcp exposes decision models (TypeSafe Jev and System One-compatible models such
as Clef) as MCP tools. A request carries some content (`state`) and typed questions;
the answer is a calibrated probability per question. The server never writes text,
never fills in a missing answer and never turns an error into a probability.

The server also sends MCP `instructions` when a client connects: a short guide for
the calling AI (tool choice, errors, ambiguous results, available providers), built
from the server's configuration ([src/mcp/instructions.ts](../src/mcp/instructions.ts)).
Clients such as Claude Code keep them in context in every session, so they stay
around 1,000 characters; question writing, result fields and image rules are in the
tool descriptions instead. Claude Code keeps only the first 2048 characters of a
server's instructions.

## Connecting

| Option | When | How |
| --- | --- | --- |
| stdio | The client runs on this machine and can start a process | `node dist/transport/stdio.js` |
| Streamable HTTP | Several local clients share one server | `npm run start:http`, then `http://127.0.0.1:8098/mcp` with `Authorization: Bearer <JEV_HTTP_TOKEN>` |
| Docker | Like HTTP, restarting by itself | `docker compose up -d --build` |
| ChatGPT | ChatGPT calls from OpenAI's servers | OpenAI Secure MCP Tunnel to the stdio server ([clients.md](clients.md#chatgpt)) |

The HTTP server accepts loopback connections only. A client that cannot send an
`Authorization` header, or that needs OAuth, cannot use it yet.

## Choosing a tool

| Task | Tool |
| --- | --- |
| One yes/no question | `jev.noul` |
| Pick one option (classification) | `jev.choice` |
| Rate on ordered levels | `jev.score` |
| Several questions about the same content | `jev.evaluate` (one request; cheaper than separate calls) |
| The same questions about many items (classify a list, rank candidates) | `jev.evaluate_batch` (up to 100 items, one billed request each) |
| Model names per provider | `jev.models` |

Every question tool takes `state`, the question (`instructions` and `criteria`, or a
`questions` map for `jev.evaluate` and `jev.evaluate_batch`), and optionally
`provider`, `model` and `images`.

```json
{
  "state": "Help! My payouts have been failing for 3 days.",
  "questions": {
    "urgent": { "type": "noul", "instructions": "Does the customer need help today?" },
    "team": {
      "type": "choice",
      "instructions": "Which team should handle this message?",
      "criteria": { "billing": "Payments, payouts, refunds", "technical": "Bugs, outages", "none": null }
    }
  }
}
```

## Writing questions

- Put the content in `state`, as text or JSON. With JSON, refer to parts in the
  question with backticked paths such as `ticket.messages[0].text`.
- `instructions` must state the whole question: question IDs are not shown to the
  model.
- Ask one narrow judgment per question rather than a combined one.
- Describe what each option or level means in `criteria`; give `jev.choice` a
  `none` option when nothing may fit.
- When a result sits near 0.5, the question is ambiguous. Add the rule that decides
  it ("urgent means customers cannot use the service right now") instead of asking
  again.

## Reading results

| Tool | Result |
| --- | --- |
| `jev.noul` | `answer.noul`: probability of yes, 0 to 1 |
| `jev.choice` | `answer.choice` (most likely option), `probabilities` per option, `confidence` |
| `jev.score` | `answer.score` (probability-weighted level from 0), `probabilities` per level, `confidence`, `legend` |
| `jev.evaluate` | `answers` keyed by question ID |
| `jev.evaluate_batch` | `results` in input order with `status` `ok`, `error` or `skipped`; `summary`; total `usage` |

Every result also has `model` (the model that answered), `provider` and `usage`
(`inputTokens`, `outputTokens`, and `costUsd` when the provider reports a cost).

## Turning probabilities into decisions

Probabilities are evidence, not decisions. Models differ in calibration: in testing,
Clef reported lower confidence than Jev, and GPT-6 Luna mostly answered 0 or 1. To
use a result in a workflow:

1. Collect 50 to 100 real examples with the correct answer.
2. Run them through `jev.evaluate_batch` with the model you intend to use.
3. Pick the threshold that gives the error balance you need (for example, flag as
   urgent at 0.7 if missing an urgent case is worse than a false alarm).
4. Route results between thresholds (for example 0.4 to 0.7) to a person.
5. Re-check the threshold when you change the model or the question wording.

## Choosing a provider

A server offers one or more providers (`JEV_PROVIDERS`); `jev.models` lists the
models of each, tagged with `provider`.

| Provider | Typical models | Notes |
| --- | --- | --- |
| `typesafe` | `jev-latest`, `jev-preview` | Text only |
| `openrouter` | `cloudflare/clef-flash`, `cloudflare/clef`, `typesafe/jev-1.13` | `model` is required; Clef reads images; cost reported per request |
| `local` | `clef-flash` (llama.cpp) | Only while the local server runs; no per-request cost; nothing leaves the machine |

Omitting `provider` uses the server's default. To compare models, send the same
question with a different `provider` and `model`.

## Images

Only image-capable models read images (Clef through OpenRouter or a local server).
Send them in `images`, as `{ "data": "data:image/png;base64,..." }` or, when the
server allows it (`JEV_IMAGE_DIRS`), `{ "path": "<absolute path>" }`. Never put
images inside `state`. A request with images for a text-only model is rejected
before it is sent.

## Errors

A failed call returns `isError: true` with `{ "error": { "kind", "message", ... } }`.

| `kind` | Meaning | What to do |
| --- | --- | --- |
| `invalid_input`, `invalid_request` | The request breaks a rule; nothing was billed | Fix the input as the message says |
| `authentication`, `authorization` | Wrong or missing key | Stop; fix the server configuration |
| `payment_required` | No credits left with the provider | Stop; add credits |
| `configuration` | The server is misconfigured | Stop; fix the environment |
| `rate_limited`, `overloaded`, `timeout`, `network` | Temporary; the server already retried | Try again later |
| `refused` | The model declined this question | Rephrase, or use another model |
| `invalid_response`, `provider_error` | The provider answered badly | Report it; do not substitute a value |

In `jev.evaluate_batch`, each item carries its own error; after an error every
remaining item would also hit (such as `authentication`), the rest are `skipped`.

## Cost

- Each provider request is billed by its provider. `jev.evaluate` asks all
  questions in one request; `jev.evaluate_batch` sends one request per item.
- `usage.costUsd` appears only when the provider reports it (OpenRouter does,
  TypeSafe does not); the server never estimates cost.
- Requests rejected before sending (invalid input, missing model, text over
  `JEV_MAX_INPUT_CHARS`) cost nothing.
