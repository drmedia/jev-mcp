import { describe, expect, it } from "vitest";
import { JevError } from "../../src/core/errors.js";
import { JevCore } from "../../src/core/jev-core.js";
import type { JevEvaluateResult } from "../../src/core/provider.js";
import { MockJevProvider } from "../support/mock-provider.js";

const input = {
  state: "Help! My payouts have been failing for 3 days.",
  questions: {
    is_urgent: { type: "noul", instructions: "Does this convey urgency?" },
    department: {
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: { billing: null, technical: null },
    },
    frustration: {
      type: "score",
      instructions: "How frustrated is the customer?",
      criteria: ["Calm", "Frustrated", "Very angry"],
    },
  },
};

const validResult: JevEvaluateResult = {
  model: "jev-1.13.0",
  answers: {
    is_urgent: { type: "noul", noul: 0.95 },
    department: {
      type: "choice",
      choice: "billing",
      confidence: 0.81,
      probabilities: { billing: 0.88, technical: 0.12 },
    },
    frustration: {
      type: "score",
      score: 1.05,
      confidence: 0.92,
      legend: { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
      probabilities: { "0": 0, "1": 0.95, "2": 0.05 },
    },
  },
  usage: { inputTokens: 318, outputTokens: 34 },
};

function coreReturning(result: JevEvaluateResult) {
  const provider = new MockJevProvider({ evaluate: () => result });
  return { provider, core: new JevCore({ provider, defaultModel: "jev-latest" }) };
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

describe("JevCore.evaluate", () => {
  it("sends all questions in one provider request and returns the answers", async () => {
    const { provider, core } = coreReturning(validResult);

    await expect(core.evaluate(input)).resolves.toEqual(validResult);

    expect(provider.evaluateCalls).toHaveLength(1);
    expect(Object.keys(provider.evaluateCalls[0]!.questions)).toEqual([
      "is_urgent",
      "department",
      "frustration",
    ]);
  });

  it("uses the default model unless the input names one", async () => {
    const { provider, core } = coreReturning(validResult);

    await core.evaluate(input);
    await core.evaluate({ ...input, model: "jev-1.13.0" });

    expect(provider.evaluateCalls.map((r) => r.model)).toEqual(["jev-latest", "jev-1.13.0"]);
  });

  it("rejects invalid input before calling the provider", async () => {
    const { provider, core } = coreReturning(validResult);

    const error = await captureError(core.evaluate({ state: "x", questions: {} }));

    expect(error.kind).toBe("invalid_input");
    expect(error.message).toContain("questions: must contain at least one question");
    expect(provider.evaluateCalls).toHaveLength(0);
  });

  it("propagates provider errors unchanged", async () => {
    const providerError = new JevError("rate_limited", "slow down", { status: 429 });
    const provider = new MockJevProvider({
      evaluate: () => {
        throw providerError;
      },
    });
    const core = new JevCore({ provider, defaultModel: "jev-latest" });

    await expect(core.evaluate(input)).rejects.toBe(providerError);
  });

  it.each<[string, (answers: JevEvaluateResult["answers"]) => void, string]>([
    ["a missing answer", (a) => delete a.frustration, "frustration: missing answer"],
    [
      "an unrequested answer",
      (a) => (a.extra = { type: "noul", noul: 0.5 }),
      "extra: answer for a question that was not asked",
    ],
    [
      "a mismatched answer type",
      (a) => (a.is_urgent = { type: "score", score: 0, confidence: 1, legend: {}, probabilities: {} }),
      "is_urgent: expected a noul answer, got score",
    ],
    ["a noul outside 0..1", (a) => (a.is_urgent = { type: "noul", noul: 1.2 }), "noul is outside 0..1"],
    [
      "a choice that was not offered",
      (a) => (a.department = { ...(a.department as object), choice: "sales" } as never),
      'choice "sales" is not one of the requested options',
    ],
    [
      "a score above the highest level",
      (a) => (a.frustration = { ...(a.frustration as object), score: 2.5 } as never),
      "score is outside 0..2",
    ],
    [
      "a confidence outside 0..1",
      (a) => (a.department = { ...(a.department as object), confidence: -0.1 } as never),
      "department: confidence is outside 0..1",
    ],
  ])("rejects %s instead of passing it through", async (_label, mutate, expected) => {
    const result = structuredClone(validResult);
    mutate(result.answers);
    const { core } = coreReturning(result);

    const error = await captureError(core.evaluate(input));

    expect(error.kind).toBe("invalid_response");
    expect(error.message).toContain(expected);
  });
});

describe("JevCore.models", () => {
  it("delegates to the provider", async () => {
    const models = { models: [{ name: "jev-latest", description: "d", releaseDate: "2026-09-15" }] };
    const core = new JevCore({
      provider: new MockJevProvider({ models: () => models }),
      defaultModel: "jev-latest",
    });

    await expect(core.models()).resolves.toEqual(models);
  });
});
