import { JevError } from "../../core/errors.js";
import type { JevRequestOptions } from "../../core/provider.js";
import { errorFromResponse, type ErrorBodyParser } from "./http-errors.js";

export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Node's fetch rejects with a generic "fetch failed" TypeError; the useful
 * reason (e.g. ECONNRESET, ENOTFOUND, UND_ERR_CONNECT_TIMEOUT) is on `cause`.
 */
function describeFetchFailure(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" ? `${code}: ${cause.message}` : cause.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export interface JsonHttpClientOptions {
  /** Provider name used in error messages, e.g. "TypeSafe". */
  label: string;
  apiKey: string;
  baseUrl: string;
  parseErrorBody: ErrorBodyParser;
  timeoutMs?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** Bearer-authenticated JSON over HTTP with timeout, cancellation and error mapping. */
export class JsonHttpClient {
  readonly #label: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #parseErrorBody: ErrorBodyParser;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: JsonHttpClientOptions) {
    this.#label = options.label;
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#parseErrorBody = options.parseErrorBody;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  get label(): string {
    return this.#label;
  }

  async request(
    method: "GET" | "POST",
    path: string,
    payload: unknown,
    options: JevRequestOptions = {},
  ): Promise<unknown> {
    const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "application/json",
    };
    if (payload !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        ...(payload !== undefined && { body: JSON.stringify(payload) }),
        signal,
      });
    } catch (error) {
      // Caller cancellation is not a provider failure; surface it unchanged.
      if (options.signal?.aborted) throw error;
      if (timeoutSignal.aborted) {
        throw new JevError("timeout", `${this.#label} request timed out after ${this.#timeoutMs} ms`, {
          cause: error,
        });
      }
      throw new JevError(
        "network",
        `Could not reach the ${this.#label} API (${describeFetchFailure(error)})`,
        { cause: error },
      );
    }

    if (!response.ok) throw await errorFromResponse(response, this.#label, this.#parseErrorBody);

    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new JevError("invalid_response", `${this.#label} API returned a non-JSON response`, {
        status: response.status,
        details: text.slice(0, 2000),
        cause: error,
      });
    }
  }
}
