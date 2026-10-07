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

## Error bodies

| Case | Source | Body |
| --- | --- | --- |
| 422 validation | OpenAPI `HTTPValidationError` | `{ "detail": [{ "loc": [...], "msg": "...", "type": "..." }] }` |
| Auth failure | Observed only | `{ "detail": { "error_type": "authentication_error", "message": "..." } }` |

The docs also list `429 Too Many Requests` and `529 Overloaded` without a body schema.

## Known discrepancies

- **Missing API key returns 403, not 401.** The docs list `401` for a "missing or
  invalid API key". In practice, a request without an `Authorization` header gets `403`.
  An invalid key gets `401`. Both carry `error_type: "authentication_error"`.
  `http-errors.ts` maps by `error_type` first, and
  `tests/contract/typesafe-models.contract.test.ts` pins the behavior.
