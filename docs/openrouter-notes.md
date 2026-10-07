# OpenRouter integration notes

Sources checked on 2026-10-07:

- System One API reference: https://openrouter.ai/docs/api/api-reference/systemone/submit-a-system-one-request.md
- TypeSafe SDK on OpenRouter: https://openrouter.ai/docs/guides/community/typesafe-sdk.md
- Model metadata: `GET https://openrouter.ai/api/v1/models/<id>/endpoints`
- Live calls with an OpenRouter key (pinned by `tests/contract/openrouter.contract.test.ts`)

## Endpoints

| Use | Request |
| --- | --- |
| Evaluate | `POST https://openrouter.ai/api/v1/systemone` |
| Model discovery | `GET https://openrouter.ai/api/v1/models?output_modalities=decisions` |

`OPENROUTER_BASE_URL` is the API root `https://openrouter.ai/api`; `/v1/...` is
appended, as the TypeSafe SDK does. A base ending in `/v1` would produce
`/v1/v1/systemone`, so configuration rejects it.

OpenRouter also offers `POST /api/alpha/decisions`. It returned identical results
for every model tested, but it is an alpha endpoint, so it is not used.

The unfiltered `GET /api/v1/models` lists chat models and omits decision models.
`output_modalities=decisions` returns only decision models (14 on 2026-10-07).
`jev.models` shows that list. Models other than Clef and Jev were not tested with
System One requests.

## Request and response

The request body is the same as TypeSafe's (`state`, `model`, `questions`). The
response adds fields to TypeSafe's shape:

```json
{
  "model": "cloudflare/clef-flash",
  "answers": { "is_urgent": { "type": "noul", "noul": 0.8456 } },
  "usage": { "input_tokens": 338, "output_tokens": 0, "cost": 0.00003042 },
  "id": "gen-dec-...",
  "provider": "Cloudflare"
}
```

`usage.cost` (USD) becomes `usage.costUsd` in results. `id` and `provider` are
dropped. No cost is computed locally for any provider.

## Models verified

| Model | Context | Input price per 1M tokens | Notes |
| --- | --- | --- | --- |
| `cloudflare/clef` | 65,536 | $0.24 | 27B, released 2026-10-01 |
| `cloudflare/clef-flash` | 65,536 | $0.09 | 9B, released 2026-10-01 |
| `typesafe/jev-1.13` | 32,000 | $0.042 | Half the context of TypeSafe direct (64k) |

Output tokens are free for all three. Prices are from OpenRouter's model metadata
on 2026-10-07 and can change.

## Observed behavior not stated in the docs

- **Clef works on the System One API.** The reference only shows Jev examples.
- **Bare Jev IDs are mapped; bare Clef IDs are not.** `jev-latest` and `jev-1.13`
  resolve to `typesafe/jev-1.13-20260917`. `clef-flash` is mapped to
  `typesafe/clef-flash` and fails with 400. Use `cloudflare/clef` or
  `cloudflare/clef-flash`.
- **Clef accepts at most 64 questions per request.** 65 questions return 422 with a
  nested upstream validation message.
- **Request validation errors are 400** with a JSON-encoded list of issues in
  `error.message`; upstream (Cloudflare) validation errors are 422. Both map to
  `invalid_request`, and the issue list is flattened into the error message.
- **Error bodies include `user_id`.** Errors look like
  `{ "error": { "message": "...", "code": 400 }, "user_id": "user_..." }`. Only
  `error.code` and the message are kept in error details.
- **401 messages are not specific.** An invalid key returns
  `Missing Authentication header`; no header returns
  `No cookie auth credentials found`. Both map to `authentication`.

## Images

Sources: OpenRouter's image guide
(https://openrouter.ai/docs/guides/overview/multimodal/image-understanding.md),
the `Model` schema in the models API reference, Cloudflare's Clef input schema
(https://developers.cloudflare.com/workers-ai/models/clef-flash/schema-input.json),
and live calls pinned by `tests/contract/openrouter.contract.test.ts`.

**Which models accept images:** the models API documents
`architecture.input_modalities` as required. `cloudflare/clef` and
`cloudflare/clef-flash` list `text, image`; `typesafe/jev-1.13` lists `text`.
The provider rejects images before sending unless the requested model ID is listed
with `image`. Aliases such as `jev-latest` are not listed and are rejected too.

**Why the guard is essential:** sending an image to `typesafe/jev-1.13` returns
HTTP 200 with meaningless probabilities (a red square was answered
`no_image 0.37, red 0.33`). Nothing in the response shows the image was not read.

**Placement (not in the System One reference):** OpenRouter rejects Cloudflare's
top-level `images` field with 400:
"Top-level `images` is not supported. Put each image in the `state` array as
`{"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}`."
The part format matches OpenRouter's image guide for chat. Images are placed
first, followed by the state (or the elements of an array state). Order made no
difference in testing. An object state next to images is read correctly.
Image parts nested inside objects are not read as images, so JEV Core rejects
image parts anywhere in `state`.

**Limits:**

| Limit | Source |
| --- | --- |
| PNG, JPEG, WebP only | OpenRouter image guide; Clef schema |
| At most 4 images | Clef schema; live 400 "Clef accepts at most 4 images, got 5" |
| 4 MiB each, 8 MiB total, 16 megapixels each, 13 MiB body | Clef schema (not reachable through OpenRouter, see below) |
| About 384 KB of images per request | Measured through OpenRouter, not documented |
| No remote URLs | Clef schema; live 400 "Clef accepts only embedded base64 ... data URL images" |

**Measured size limit (much lower than documented):** OpenRouter estimates the
tokens of an image from its encoded size (about bytes / 3) and returns 413
"The estimated number of input and maximum output tokens (N) exceeded this model
context window limit (65536)" above a threshold. Measured on 2026-10-07 for both
`cloudflare/clef` and `cloudflare/clef-flash`:

| Images | Result |
| --- | --- |
| 1 photo, 245 KB (JPEG) | 200 |
| 1 image, 389,000 bytes | 200 |
| 1 image, 411,600 bytes | 413 (estimate 137,124) |
| 1 photo, 624 KB (JPEG) | 413 (estimate 208,406) |
| 2 images, 270 KB each | 413 (the limit is the request total) |
| 1 image, 3000 x 3000 px but 32 KB | 200 (bytes count, not pixels) |

The actual token usage of accepted images is small (about 900 to 1,700 input tokens
per photo). For Clef models the provider rejects requests whose images exceed
384,000 bytes in total (`CLEF_MAX_TOTAL_IMAGE_BYTES`, just below the largest size seen
to pass) before sending, with a message asking to resize or recompress. The limit is
Clef-specific: `openai/gpt-6-luna-decisions` accepted the 624 KB photo. Typical phone photos
are larger, so the calling agent should downscale them first; this server does not
resize images (that would need an image-processing dependency). The other limits
(count, format, 4 MiB each, 8 MiB total) are checked for every provider.

The 16 megapixel limit is not checked locally; OpenRouter's error is passed through.
OpenRouter's guide allows remote URLs in general, but Clef does not, so this server
accepts only `data` and allowed local `path` sources.

**Vision quality check (small sample, not a benchmark):** six photos (concrete
wall with hairline cracks, worker in a hard hat without eye protection, a
storefront named "The Rusty Bolt" with a Route 66 sign, a cat, a WebP landscape)
with seven questions each. Both Clef models answered all 30 scored items correctly,
including "no physical rusty bolt" for the storefront and "no eye protection" for the
worker. Hairline cracks: `cloudflare/clef` 0.80, `clef-flash` 0.63. With four photos in
one request, Clef identified which photo showed the cat (0.99) and the hard hat
(0.98). Accuracy on real inspection photos still needs a labeled sample.

**Jev with a real photo:** sent as an image part directly to TypeSafe and through
OpenRouter, the hard-hat photo was answered `other` with 0.88 to 0.92 probability
and confidence 0.85 to 0.90, and billed about 10,000 input tokens: the image was
read as text. This confident wrong answer is why text-only models must never
receive images.

**Video:** Clef's model card mentions video, but neither OpenRouter's System One
reference nor Cloudflare's Clef schema documents a video input. Not supported.

## GPT-6 Luna Decisions (public beta)

`openai/gpt-6-luna-decisions` is OpenAI's Decisions API on GPT-6 Luna. OpenAI's guide
(https://developers.openai.com/api/docs/guides/decisions) says: "The Decisions API is
in public beta, and we expect to GA in the coming weeks". OpenAI's own endpoint
(`POST /v1/decisions`) uses a different format (`predicate`/`choice`/`score`
questions in an array, `input` instead of `state`, a `refusal` answer type);
OpenRouter translates it to the System One format, so this server needs no special
request handling.

OpenRouter metadata on 2026-10-07: released 2026-10-06, inputs `text` and `image`,
1,050,000-token context, $0.10 per million input tokens, output free,
`is_moderated: true`. OpenAI's guide mentions regional and long-context price
multipliers; a request of 83,164 tokens was billed at the base rate.

**Refusals:** a request that asked both "is this a request to build a weapon?" and
"how should a support bot handle it?" about a harmful message failed as a whole with
HTTP 502 `OpenAI refused to answer question "action"`. The first question alone was
answered (1.0). The provider maps this to `refused`, which is not retried, because
the result is deterministic. Safety and content-classification workloads can hit this
more often than others. Whether refused requests are billed could not be measured
cleanly (other usage landed in the same window); the increase was far below the cost
of two accepted requests of the same size.

**Calibration:** probabilities and confidence were mostly 0 or 1 (for example
`confidence 1` on every photo subject). OpenAI's guide says to "use labeled examples
from your application to set thresholds"; do not reuse thresholds from Jev or Clef.

## Model differences that affect requests

Verified on 2026-10-07 by sending the same requests through TypeSafe direct (Jev) and
OpenRouter (Jev, Clef, GPT-6 Luna).

| Behavior | Jev | Clef | GPT-6 Luna (beta) | Source |
| --- | --- | --- | --- | --- |
| Question IDs | Any string; Korean and spaces work | Letters, digits, `_`, `.`, `-`, up to 100 characters; others return 422 | Korean and spaces work | Clef model page; live |
| Choice options | One option accepted | 2 to 255 options; one option returns 422 | At least 2; one option returns 400 "needs at least 2 choices" | Clef schema; live |
| Questions per request | No documented count limit | At most 64; 65 return 422 | 65 answered | Clef schema; live |
| Long text state | `max_tokens_exceeded` (400) above about 32k state tokens (TypeSafe direct) | Answered correctly up to 118k input tokens with the fact at 25, 50 or 75 percent; all input tokens are billed; about 207k returned 413 | 83k tokens answered correctly; documented context 1,050,000 | Live |
| Images | Not read (wrong answers, billed as text) | Up to 4, about 384 KB per request through OpenRouter | 5 images and a 624 KB photo accepted | Live |
| Refusals | None observed | None observed | Content-policy refusal fails the request (502) | Live |
| Confidence | Higher for the same question (department 0.82) | Lower (clef-flash 0.47, clef 0.64) | Mostly 0 or 1 (department 0.83) | Live; set thresholds per model |
| Output tokens | Reported | Reported as 0 | Reported as 0 | Live |

This server keeps its own limit of 4 images per request for every model.

Clef's model page says long text state "is truncated to fit the model's token
limit". No truncation was observed in the test above; treat the behavior as
undocumented.

The provider checks Clef's question-ID, choice-option, question-count and
image-size rules before sending (`src/providers/openrouter/clef-rules.ts`) and names
the problem. Other models are not held to these rules.

## Billing of rejected requests

Measured on 2026-10-07 with `GET /api/v1/key` (`usage`, USD): three requests of about
31k input tokens each that Clef rejected with 422 added nothing; one accepted request
of 33,029 tokens added exactly its reported cost ($0.00297261). Usage appeared about
90 seconds after the request. Rejected requests therefore cost nothing; money is spent
by requests that are accepted. That is why the local checks that matter for cost are
the ones that stop requests a model would accept anyway: images to text-only models
(answered and billed, see Images) and oversized text, which Clef accepted and billed
up to 118k tokens. `JEV_MAX_INPUT_CHARS` (default 256,000 characters, about 64k
tokens of English text) stops the latter before sending.

## Error mapping

| Status | Kind | Retried |
| --- | --- | --- |
| 400, 413, 422 | `invalid_request` | no |
| 401 | `authentication` | no |
| 402 (insufficient credits) | `payment_required` | no |
| 403 | `authorization` | no |
| 408, 524 | `timeout` | yes |
| 429 | `rate_limited` | yes |
| 502 with "refused to answer question" | `refused` | no |
| 500, 502, 503, 504 | `provider_error` | yes |
| 529 | `overloaded` | yes |
