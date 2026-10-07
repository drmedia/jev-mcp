import { JevError } from "../core/errors.js";
import type {
  JevEvaluateRequest,
  JevEvaluateResult,
  JevModelList,
  JevProvider,
  JevRequestOptions,
} from "../core/provider.js";

export interface RetryPolicy {
  /** Retries after the first attempt. 0 disables retries. */
  maxRetries: number;
  /** Upper bound for the first backoff; doubles on each retry. */
  baseDelayMs: number;
  /** Cap for any single wait, including a provider's retry-after. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
};

const RETRYABLE_SERVER_STATUSES = new Set([500, 502, 503, 504]);

/**
 * Transient failures only (AGENTS.md section 15). Authentication, authorization,
 * invalid input or requests, and invalid responses are deterministic and never retried.
 */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof JevError)) return false;
  switch (error.kind) {
    case "rate_limited":
    case "overloaded":
    case "timeout":
    case "network":
      return true;
    case "provider_error":
      return error.status !== undefined && RETRYABLE_SERVER_STATUSES.has(error.status);
    default:
      return false;
  }
}

/**
 * Milliseconds to wait before retry number `retry` (0-based), or undefined when
 * the provider asked for a longer wait than the policy allows.
 */
export function retryDelayMs(
  error: unknown,
  retry: number,
  policy: RetryPolicy,
  random: () => number,
): number | undefined {
  const retryAfterSeconds = error instanceof JevError ? error.retryAfterSeconds : undefined;
  if (retryAfterSeconds !== undefined) {
    const requested = retryAfterSeconds * 1000;
    return requested <= policy.maxDelayMs ? requested : undefined;
  }
  // Exponential backoff with full jitter.
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** retry);
  return Math.round(random() * ceiling);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface RetryingJevProviderOptions {
  policy?: Partial<RetryPolicy>;
  /** Called before each retry; used for diagnostics. */
  onRetry?: (event: { operation: string; retry: number; delayMs: number; error: JevError }) => void;
  /** Injected for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

/** Decorates any JevProvider with bounded retries for transient failures. */
export class RetryingJevProvider implements JevProvider {
  readonly #inner: JevProvider;
  readonly #policy: RetryPolicy;
  readonly #onRetry: RetryingJevProviderOptions["onRetry"];
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #random: () => number;

  constructor(inner: JevProvider, options: RetryingJevProviderOptions = {}) {
    this.#inner = inner;
    this.#policy = { ...DEFAULT_RETRY_POLICY, ...options.policy };
    this.#onRetry = options.onRetry;
    this.#sleep = options.sleep ?? sleep;
    this.#random = options.random ?? Math.random;
  }

  models(options?: JevRequestOptions): Promise<JevModelList> {
    return this.#withRetry("models", options, () => this.#inner.models(options));
  }

  evaluate(request: JevEvaluateRequest, options?: JevRequestOptions): Promise<JevEvaluateResult> {
    return this.#withRetry("evaluate", options, () => this.#inner.evaluate(request, options));
  }

  async #withRetry<T>(
    operation: string,
    options: JevRequestOptions | undefined,
    attempt: () => Promise<T>,
  ): Promise<T> {
    for (let retry = 0; ; retry++) {
      try {
        return await attempt();
      } catch (error) {
        if (retry >= this.#policy.maxRetries || !isRetryable(error) || options?.signal?.aborted) {
          throw error;
        }
        const delayMs = retryDelayMs(error, retry, this.#policy, this.#random);
        if (delayMs === undefined) throw error;
        this.#onRetry?.({ operation, retry: retry + 1, delayMs, error: error as JevError });
        await this.#sleep(delayMs, options?.signal);
      }
    }
  }
}
