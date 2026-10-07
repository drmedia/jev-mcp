import { JevError, type JevErrorKind } from "../../core/errors.js";

const MAX_DETAIL_TEXT_LENGTH = 2000;

interface ParsedErrorBody {
  message: string | undefined;
  providerCode: string | undefined;
  details: unknown;
}

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
 * - auth errors (observed, not in OpenAPI): `{ detail: { error_type, message } }`
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
    return {
      message: typeof detail.message === "string" ? detail.message : undefined,
      providerCode: typeof detail.error_type === "string" ? detail.error_type : undefined,
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

function kindForStatus(status: number, providerCode: string | undefined): JevErrorKind {
  // TypeSafe answers a missing API key with 403 + `authentication_error`,
  // although the docs list 401 for that case. Trust the error type over the status.
  if (providerCode === "authentication_error") return "authentication";
  switch (status) {
    case 401:
      return "authentication";
    case 403:
      return "authorization";
    case 408:
      return "timeout";
    case 400:
    case 422:
      return "invalid_request";
    case 429:
      return "rate_limited";
    case 529:
      return "overloaded";
    default:
      return "provider_error";
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || !/^\d+$/.test(header.trim())) return undefined;
  return Number(header.trim());
}

export async function errorFromResponse(response: Response): Promise<JevError> {
  const text = await response.text().catch(() => "");
  const parsed = parseErrorBody(text);
  const kind = kindForStatus(response.status, parsed.providerCode);
  const message = `TypeSafe API returned HTTP ${response.status}${
    parsed.message ? `: ${parsed.message}` : ""
  }`;
  const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
  return new JevError(kind, message, {
    status: response.status,
    ...(parsed.providerCode !== undefined && { providerCode: parsed.providerCode }),
    ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
    details: parsed.details,
  });
}
