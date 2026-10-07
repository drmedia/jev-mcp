export type JevErrorKind =
  | "configuration"
  | "invalid_input"
  | "authentication"
  | "authorization"
  | "invalid_request"
  | "rate_limited"
  | "overloaded"
  | "timeout"
  | "network"
  | "invalid_response"
  | "provider_error";

export interface JevErrorOptions {
  /** HTTP status returned by the provider, when the error came from an HTTP response. */
  status?: number;
  /** Provider-specific error code, e.g. TypeSafe's `detail.error_type`. */
  providerCode?: string;
  /** Seconds from a `retry-after` header, when the provider sent one. */
  retryAfterSeconds?: number;
  /** Parsed or raw provider payload kept for diagnostics. Must never contain secrets. */
  details?: unknown;
  cause?: unknown;
}

export class JevError extends Error {
  readonly kind: JevErrorKind;
  readonly status: number | undefined;
  readonly providerCode: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly details: unknown;

  constructor(kind: JevErrorKind, message: string, options: JevErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "JevError";
    this.kind = kind;
    this.status = options.status;
    this.providerCode = options.providerCode;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details;
  }
}
