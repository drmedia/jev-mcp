import { describe, expect, it } from "vitest";
import { JevError } from "../../src/core/errors.js";
import { JevCore } from "../../src/core/jev-core.js";
import type { JevEvaluateRequest, JevEvaluateResult } from "../../src/core/provider.js";
import { MAX_BATCH_ITEMS } from "../../src/schemas/batch.js";
import { pngDataUrl } from "../support/images.js";
import { MockJevProvider } from "../support/mock-provider.js";

const questions = {
  team: {
    type: "choice",
    instructions: "Which team should handle this ticket?",
    criteria: { billing: null, technical: null },
  },
};

function answerFor(request: JevEvaluateRequest, costUsd?: number): JevEvaluateResult {
  const billing = String(request.state).includes("payout");
  return {
    model: "jev-1.13.0",
    answers: {
      team: {
        type: "choice",
        choice: billing ? "billing" : "technical",
        confidence: 0.8,
        probabilities: billing ? { billing: 0.9, technical: 0.1 } : { billing: 0.2, technical: 0.8 },
      },
    },
    usage: { inputTokens: 100, outputTokens: 10, ...(costUsd !== undefined && { costUsd }) },
  };
}

function core(provider: MockJevProvider, maxConcurrency?: number): JevCore {
  return new JevCore({
    provider,
    defaultModel: "jev-latest",
    ...(maxConcurrency !== undefined && { maxConcurrency }),
  });
}

async function captureError(promise: Promise<unknown>): Promise<JevError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(JevError);
    return error as JevError;
  }
  throw new Error("expected promise to reject");
}

describe("JevCore.evaluateBatch", () => {
  it("sends one request per item with the shared questions and returns results in input order", async () => {
    const provider = new MockJevProvider({ evaluate: (request) => answerFor(request) });

    const result = await core(provider).evaluateBatch({
      items: [{ id: "t1", state: "My payout failed" }, { state: "The app crashes on login" }],
      questions,
      model: "jev-1.13",
    });

    expect(provider.evaluateCalls).toEqual([
      { state: "My payout failed", model: "jev-1.13", questions },
      { state: "The app crashes on login", model: "jev-1.13", questions },
    ]);
    expect(result.results.map((item) => [item.index, item.id, item.status])).toEqual([
      [0, "t1", "ok"],
      [1, undefined, "ok"],
    ]);
    expect(result.results[1]).not.toHaveProperty("id");
    const first = result.results[0]!;
    expect(first.status === "ok" && first.answers.team).toMatchObject({ choice: "billing" });
    expect(result.summary).toEqual({ ok: 2, error: 0, skipped: 0 });
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 20 });
  });

  it("uses the default model and sends each item's own images", async () => {
    const provider = new MockJevProvider({ evaluate: (request) => answerFor(request) });

    await core(provider).evaluateBatch({
      items: [{ state: "photo one", images: [{ data: pngDataUrl([200, 30, 30]) }] }, { state: "no photo" }],
      questions,
    });

    expect(provider.evaluateCalls[0]!.model).toBe("jev-latest");
    expect(provider.evaluateCalls[0]!.images).toHaveLength(1);
    expect(provider.evaluateCalls[1]).not.toHaveProperty("images");
  });

  it("keeps each item's error and the other items' answers", async () => {
    const provider = new MockJevProvider({
      evaluate: (request) => {
        if (request.state === "bad") throw new JevError("invalid_request", "rejected by provider", { status: 422 });
        return answerFor(request);
      },
    });

    const result = await core(provider).evaluateBatch({
      items: [{ state: "My payout failed" }, { state: "bad" }, { state: "crash" }],
      questions,
    });

    expect(result.results[1]).toEqual({
      index: 1,
      status: "error",
      error: { kind: "invalid_request", message: "rejected by provider", status: 422 },
    });
    expect(result.results.map((item) => item.status)).toEqual(["ok", "error", "ok"]);
    expect(result.summary).toEqual({ ok: 2, error: 1, skipped: 0 });
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 20 });
  });

  it("reports answers that do not match the questions as that item's invalid_response", async () => {
    const provider = new MockJevProvider({
      evaluate: (request) =>
        request.state === "odd" ? { model: "m", answers: {}, usage: { inputTokens: 1, outputTokens: 0 } } : answerFor(request),
    });

    const result = await core(provider).evaluateBatch({ items: [{ state: "odd" }, { state: "fine" }], questions });

    const failed = result.results[0]!;
    expect(failed.status === "error" && failed.error.kind).toBe("invalid_response");
    expect(result.results[1]!.status).toBe("ok");
  });

  it.each(["authentication", "authorization", "payment_required"] as const)(
    "skips items not yet sent after %s",
    async (kind) => {
      const provider = new MockJevProvider({
        evaluate: () => {
          throw new JevError(kind, "provider says no");
        },
      });

      const result = await core(provider, 1).evaluateBatch({
        items: [{ state: "a" }, { state: "b" }, { state: "c" }],
        questions,
      });

      expect(provider.evaluateCalls).toHaveLength(1);
      expect(result.results.map((item) => item.status)).toEqual(["error", "skipped", "skipped"]);
      const skipped = result.results[1]!;
      expect(skipped.status === "skipped" && skipped.reason).toBe(
        `Not sent: items[0] failed with ${kind}, which every remaining item would also hit`,
      );
      expect(result.summary).toEqual({ ok: 0, error: 1, skipped: 2 });
      expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    },
  );

  it("keeps sending after errors that may affect only one item", async () => {
    const provider = new MockJevProvider({
      evaluate: () => {
        throw new JevError("rate_limited", "slow down", { status: 429 });
      },
    });

    const result = await core(provider, 1).evaluateBatch({ items: [{ state: "a" }, { state: "b" }], questions });

    expect(provider.evaluateCalls).toHaveLength(2);
    expect(result.summary).toEqual({ ok: 0, error: 2, skipped: 0 });
  });

  it("never runs more than maxConcurrency requests at once", async () => {
    let running = 0;
    let peak = 0;
    const provider = new MockJevProvider({
      evaluate: async (request) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return answerFor(request);
      },
    });

    const result = await core(provider, 3).evaluateBatch({
      items: Array.from({ length: 10 }, (_, index) => ({ state: `item ${index}` })),
      questions,
    });

    expect(peak).toBe(3);
    expect(result.summary.ok).toBe(10);
    expect(result.results.map((item) => item.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("totals cost only when every successful item reported one", async () => {
    const withCost = new MockJevProvider({ evaluate: (request) => answerFor(request, 0.001) });
    const allReported = await core(withCost).evaluateBatch({ items: [{ state: "a" }, { state: "b" }], questions });
    expect(allReported.usage.costUsd).toBeCloseTo(0.002);

    let calls = 0;
    const mixed = new MockJevProvider({
      evaluate: (request) => answerFor(request, calls++ === 0 ? 0.001 : undefined),
    });
    const someReported = await core(mixed, 1).evaluateBatch({ items: [{ state: "a" }, { state: "b" }], questions });
    expect(someReported.usage).not.toHaveProperty("costUsd");
  });

  it("rejects the whole batch before sending anything when one item is invalid", async () => {
    const provider = new MockJevProvider({ evaluate: (request) => answerFor(request) });

    const error = await captureError(
      core(provider).evaluateBatch({
        items: [{ state: "fine" }, { state: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] }],
        questions,
      }),
    );

    expect(error.kind).toBe("invalid_input");
    expect(error.message).toBe(
      "items[1]: Invalid evaluate input: state contains an image part; pass images in the images field instead",
    );
    expect(provider.evaluateCalls).toHaveLength(0);
  });

  it("applies JEV_MAX_INPUT_CHARS to each item", async () => {
    const provider = new MockJevProvider({ evaluate: (request) => answerFor(request) });
    const limited = new JevCore({ provider, defaultModel: "jev-latest", maxInputChars: 300 });

    const error = await captureError(
      limited.evaluateBatch({ items: [{ state: "short" }, { state: "x".repeat(400) }], questions }),
    );

    expect(error.message).toMatch(/^items\[1\]: Invalid evaluate input: text input is \d+ characters; the limit is 300/);
    expect(provider.evaluateCalls).toHaveLength(0);
  });

  it.each([
    [{ items: [], questions }, "items: must contain at least one item"],
    [
      { items: Array.from({ length: MAX_BATCH_ITEMS + 1 }, () => ({ state: "x" })), questions },
      `items: must contain at most ${MAX_BATCH_ITEMS} items`,
    ],
    [{ items: [{ id: "a", state: "x" }, { id: "a", state: "y" }], questions }, "items: item ids must be unique"],
    [{ items: [{ state: "x" }], questions: {} }, "questions: must contain at least one question"],
    [{ items: [{ state: "x", model: "m" }], questions }, "items.0"],
  ])("rejects malformed input %#", async (input, message) => {
    const provider = new MockJevProvider();

    const error = await captureError(core(provider).evaluateBatch(input));

    expect(error.kind).toBe("invalid_input");
    expect(error.message).toContain("Invalid batch input:");
    expect(error.message).toContain(message);
  });

  it("fails as a whole and stops sending when the request is cancelled", async () => {
    const controller = new AbortController();
    const provider = new MockJevProvider({
      evaluate: () => {
        controller.abort(new Error("cancelled by client"));
        throw new Error("cancelled by client");
      },
    });

    await expect(
      core(provider, 1).evaluateBatch(
        { items: [{ state: "a" }, { state: "b" }, { state: "c" }], questions },
        { signal: controller.signal },
      ),
    ).rejects.toThrow("cancelled by client");
    expect(provider.evaluateCalls).toHaveLength(1);
  });
});
