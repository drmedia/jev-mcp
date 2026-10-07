# TypeSafe API integration notes

Sources checked on 2026-10-07:

- HTTP API reference: https://docs.typesafe.ai/api.md
- Models: https://docs.typesafe.ai/models.md
- OpenAPI schema: https://api.typesafe.ai/openapi.json (`info.version` 0.2.0)

## `GET /v1/models`

Response (`ModelMetadataList`):

```json
{ "models": [{ "name": "jev-latest", "description": "...", "release_date": "2026-09-15" }] }
```

`name`, `description` and `release_date` are all required. The docs say the list
currently contains aliases only; versioned IDs such as `jev-1.13.0` are accepted by
`POST /v1/systemone` even when not listed. Do not validate `JEV_MODEL` against this list.

## `POST /v1/systemone`

Request: `{ state, model, questions }`. `questions` maps caller-chosen IDs to
`noul`, `choice` or `score` questions. Response: `{ model, answers, usage }`, where
`answers` uses the same IDs and `usage` has `input_tokens` and `output_tokens`.
`model` in the response is the versioned ID (for example `jev-1.13.0`), even when
the request used an alias.

Input validation (`src/schemas/evaluate.ts`) follows the HTTP API reference, which
is stricter than the OpenAPI schema:

| Rule | API reference | OpenAPI |
| --- | --- | --- |
| `instructions` | required | optional, nullable |
| Choice options | at most 255 | no limit |
| Score levels | 2 to 10 ("should have at least two") | at least 1, no maximum |
| Score `legend` values | string | string, object or array |

`JevCore` also checks every provider result against the request: one answer per
question, matching type, chosen option among the requested options, score within
the level range, and probabilities and confidence within 0..1. A mismatch is an
`invalid_response` error. Answers are never filled in or adjusted.

## Error bodies

| Case | Source | Body |
| --- | --- | --- |
| 422 validation | OpenAPI `HTTPValidationError` | `{ "detail": [{ "loc": [...], "msg": "...", "type": "..." }] }` |
| Auth failure | Observed only | `{ "detail": { "error_type": "authentication_error", "message": "..." } }` |
| Unknown model (400) | Observed only | `{ "detail": { "error_type": "api_usage_error", "message": "Unknown model: <name>" } }` |

The docs also list `429 Too Many Requests` and `529 Overloaded` without a body schema.

## Known discrepancies

- **Missing API key returns 403, not 401.** The docs list `401` for a "missing or
  invalid API key". In practice, a request without an `Authorization` header gets `403`.
  An invalid key gets `401`. Both carry `error_type: "authentication_error"`.
  `http-errors.ts` maps by `error_type` first, and
  `tests/contract/typesafe-models.contract.test.ts` pins the behavior.
- **`release_date` is a timestamp, not a date.** OpenAPI describes `release_date`
  as `YYYY-MM-DD`, but the live API returns ISO 8601 timestamps such as
  `2026-09-10T18:38:01.391457+00:00`. The value is passed through as a string
  without format validation. `tests/contract/typesafe-models.contract.test.ts`
  pins the timestamp format.
- **Unknown model returns 400.** `POST /v1/systemone` with an unknown `model`
  returns `400` with `error_type: "api_usage_error"` and the message
  `Unknown model: <name>`. The docs list no 400 response. It maps to
  `invalid_request`; `tests/contract/typesafe-evaluate.contract.test.ts` pins it.
