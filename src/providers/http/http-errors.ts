import { JevError, type JevErrorKind } from "../../core/errors.js";

/** What a provider-specific parser extracts from an error response body. */
export interface ParsedErrorBody {
  message: string | undefined;
  providerCode: string | undefined;
  /** Safe-to-expose diagnostics; parsers drop fields that may identify the account. */
  details: unknown;
}

export type ErrorBodyParser = (text: string) => ParsedErrorBody;

function kindForStatus(status: number, providerCode: string | undefined): JevErrorKind {
  // TypeSafe answers a missing API key with 403 + `authentication_error`,
  // although its docs list 401 for that case. Trust the error type over the status.
  if (providerCode === "authentication_error") return "authentication";
  switch (status) {
    case 401:
      return "authentication";
    case 402:
      return "payment_required";
    case 403:
      return "authorization";
    case 408:
    case 524:
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

/** Builds a JevError from a non-2xx response using the provider's body parser. */
export async function errorFromResponse(
  response: Response,
  providerLabel: string,
  parseBody: ErrorBodyParser,
): Promise<JevError> {
  const text = await response.text().catch(() => "");
  const parsed = parseBody(text);
  const kind = kindForStatus(response.status, parsed.providerCode);
  const message = `${providerLabel} API returned HTTP ${response.status}${
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
