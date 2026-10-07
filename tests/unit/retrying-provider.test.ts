import { describe, expect, it, vi } from "vitest";
import { JevError, type JevErrorOptions } from "../../src/core/errors.js";
import type { JevEvaluateRequest, JevEvaluateResult } from "../../src/core/provider.js";
import {
  isRetryable,
  retryDelayMs,
  RetryingJevProvider,
  type RetryPolicy,
} from "../../src/providers/retrying-provider.js";
import { MockJevProvider } from "../support/mock-provider.js";

const request: JevEvaluateRequest = {
  state: "x",
  model: "jev-latest",
  questions: { q: { type: "noul", instructions: "x" } },
};

const result: JevEvaluateResult = {
  model: "jev-1.13.0",
  answers: { q: { type: "noul", noul: 0.5 } },
  usage: { inputTokens: 1, outputTokens: 1 },
};

const policy: RetryPolicy = { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 1000 };

function error(kind: JevError["kind"], options: JevErrorOptions = {}): JevError {
  return new JevError(kind, `${kind} failure`, options);
}

/** Provider that fails with the given errors in order, then succeeds. */
function flaky(errors: JevError[]) {
  const queue = [...errors];
  return new MockJevProvider({
    evaluate: () => {
      const next = queue.shift();
      if (next) throw next;
      return result;
    },
  });
}

function retrying(inner: MockJevProvider, overrides: Partial<RetryPolicy> = {}) {
  const sleep = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>().mockResolvedValue();
  const onRetry = vi.fn();
  const provider = new RetryingJevProvider(inner, {
    policy: { ...policy, ...overrides },
    sleep,
    random: () => 1,
    onRetry,
  });
  return { provider, sleep, onRetry };
}

describe("isRetryable", () => {
  it.each([
    ["rate_limited", {}, true],
    ["overloaded", {}, true],
    ["timeout", {}, true],
    ["network", {}, true],
    ["provider_error", { status: 500 }, true],
    ["provider_error", { status: 502 }, true],
    ["provider_error", { status: 503 }, true],
    ["provider_error", { status: 504 }, true],
    ["provider_error", { status: 501 }, false],
    ["provider_error", { status: 404 }, false],
    ["authentication", { status: 401 }, false],
    ["authorization", { status: 403 }, false],
    ["invalid_request", { status: 422 }, false],
    ["refused", { status: 502 }, false],
    ["payment_required", { status: 402 }, false],
    ["invalid_input", {}, false],
    ["invalid_response", {}, false],
    ["configuration", {}, false],
  ] as const)("%s %o -> %s", (kind, options, expected) => {
    expect(isRetryable(error(kind, options))).toBe(expected);
  });

  it("does not retry non-JEV errors", () => {
    expect(isRetryable(new Error("bug"))).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("backs off exponentially within the jitter ceiling", () => {
    const err = error("network");
    expect(retryDelayMs(err, 0, policy, () => 1)).toBe(100);
    expect(retryDelayMs(err, 1, policy, () => 1)).toBe(200);
    expect(retryDelayMs(err, 2, policy, () => 0.5)).toBe(200);
    expect(retryDelayMs(err, 10, policy, () => 1)).toBe(1000);
  });

  it("honors retry-after when it fits the policy and gives up when it does not", () => {
    expect(retryDelayMs(error("rate_limited", { retryAfterSeconds: 1 }), 0, policy, () => 0)).toBe(1000);
    expect(retryDelayMs(error("rate_limited", { retryAfterSeconds: 2 }), 0, policy, () => 0)).toBeUndefined();
  });
});

describe("RetryingJevProvider", () => {
  it("returns the result after transient failures", async () => {
    const inner = flaky([error("network"), error("overloaded")]);
    const { provider, sleep, onRetry } = retrying(inner);

    await expect(provider.evaluate(request)).resolves.toEqual(result);

    expect(inner.evaluateCalls).toHaveLength(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200]);
    expect(onRetry.mock.calls.map(([event]) => [event.operation, event.retry])).toEqual([
      ["evaluate", 1],
      ["evaluate", 2],
    ]);
  });

  it("stops after maxRetries and rethrows the last error unchanged", async () => {
    const last = error("network");
    const inner = flaky([error("network"), error("network"), last, error("network")]);
    const { provider } = retrying(inner);

    await expect(provider.evaluate(request)).rejects.toBe(last);
    expect(inner.evaluateCalls).toHaveLength(3);
  });

  it.each(["authentication", "invalid_request", "invalid_response"] as const)(
    "does not retry %s errors",
    async (kind) => {
      const failure = error(kind);
      const inner = flaky([failure]);
      const { provider, sleep } = retrying(inner);

      await expect(provider.evaluate(request)).rejects.toBe(failure);
      expect(inner.evaluateCalls).toHaveLength(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it("does not retry when maxRetries is 0", async () => {
    const inner = flaky([error("network")]);
    const { provider } = retrying(inner, { maxRetries: 0 });

    await expect(provider.evaluate(request)).rejects.toBeInstanceOf(JevError);
    expect(inner.evaluateCalls).toHaveLength(1);
  });

  it("waits for retry-after before retrying", async () => {
    const inner = flaky([error("rate_limited", { status: 429, retryAfterSeconds: 1 })]);
    const { provider, sleep } = retrying(inner);

    await expect(provider.evaluate(request)).resolves.toEqual(result);
    expect(sleep.mock.calls[0]?.[0]).toBe(1000);
  });

  it("gives up when retry-after exceeds the maximum wait", async () => {
    const failure = error("rate_limited", { status: 429, retryAfterSeconds: 60 });
    const inner = flaky([failure]);
    const { provider, sleep } = retrying(inner);

    await expect(provider.evaluate(request)).rejects.toBe(failure);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry once the caller has cancelled", async () => {
    const controller = new AbortController();
    const inner = new MockJevProvider({
      evaluate: () => {
        controller.abort();
        throw error("network");
      },
    });
    const { provider } = retrying(inner);

    await expect(provider.evaluate(request, { signal: controller.signal })).rejects.toBeInstanceOf(
      JevError,
    );
    expect(inner.evaluateCalls).toHaveLength(1);
  });

  it("stops waiting when cancelled during the backoff", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const inner = flaky([error("network")]);
      const provider = new RetryingJevProvider(inner, { policy, random: () => 1 });

      const pending = provider.evaluate(request, { signal: controller.signal });
      const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(10);
      controller.abort();
      await assertion;
      expect(inner.evaluateCalls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries models() with the same policy", async () => {
    const queue = [error("timeout")];
    const models = { models: [] };
    const inner = new MockJevProvider({
      models: () => {
        const next = queue.shift();
        if (next) throw next;
        return models;
      },
    });
    const { provider } = retrying(inner);

    await expect(provider.models()).resolves.toEqual(models);
  });
});
