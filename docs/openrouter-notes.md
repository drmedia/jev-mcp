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

## Error mapping

| Status | Kind | Retried |
| --- | --- | --- |
| 400, 422 | `invalid_request` | no |
| 401 | `authentication` | no |
| 402 (insufficient credits) | `payment_required` | no |
| 403 | `authorization` | no |
| 408, 524 | `timeout` | yes |
| 429 | `rate_limited` | yes |
| 500, 502, 503, 504 | `provider_error` | yes |
| 529 | `overloaded` | yes |
