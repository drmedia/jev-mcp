import type { ParsedErrorBody } from "../http/http-errors.js";

const MAX_DETAIL_TEXT_LENGTH = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatValidationIssue(issue: unknown): string | undefined {
  if (!isRecord(issue) || typeof issue.msg !== "string") return undefined;
  const loc = Array.isArray(issue.loc) ? issue.loc.join(".") : undefined;
  return loc ? `${loc}: ${issue.msg}` : issue.msg;
}

/**
 * TypeSafe error bodies come in two shapes:
 * - 422 (documented in OpenAPI `HTTPValidationError`): `{ detail: [{ loc, msg, type }] }`
 * - auth and usage errors (observed, not in OpenAPI): `{ detail: { error_type, message } }`
 * Anything else is kept verbatim in `details`.
 */
export function parseErrorBody(text: string): ParsedErrorBody {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return {
      message: undefined,
      providerCode: undefined,
      details: text.slice(0, MAX_DETAIL_TEXT_LENGTH) || undefined,
    };
  }

  const detail = isRecord(body) ? body.detail : undefined;
  if (isRecord(detail)) {
    const errorType = typeof detail.error_type === "string" ? detail.error_type : undefined;
    return {
      // Some errors carry only the type, e.g. `{ "detail": { "error_type": "max_tokens_exceeded" } }`.
      message: typeof detail.message === "string" ? detail.message : errorType,
      providerCode: errorType,
      details: body,
    };
  }
  if (Array.isArray(detail)) {
    const issues = detail.map(formatValidationIssue).filter((m) => m !== undefined);
    return {
      message: issues.length > 0 ? issues.join("; ") : undefined,
      providerCode: undefined,
      details: body,
    };
  }
  return { message: undefined, providerCode: undefined, details: body };
}
