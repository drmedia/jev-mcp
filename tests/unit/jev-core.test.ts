import { describe, expect, it } from "vitest";
import { JevError } from "../../src/core/errors.js";
import { JevCore } from "../../src/core/jev-core.js";
import type { JevEvaluateResult } from "../../src/core/provider.js";
import { pngDataUrl, solidPng } from "../support/images.js";
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

    await expect(core.evaluate(input)).resolves.toEqual({ ...validResult, provider: "default" });

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

    await expect(core.models()).resolves.toEqual({
      models: models.models.map((model) => ({ ...model, provider: "default" })),
    });
  });
});

describe("JevCore.evaluate with images", () => {
  const noulOnly = { state: "Look at the photo.", questions: { ok: { type: "noul", instructions: "Is it red?" } } };
  const noulResult: JevEvaluateResult = {
    model: "cloudflare/clef-flash",
    answers: { ok: { type: "noul", noul: 0.97 } },
    usage: { inputTokens: 300, outputTokens: 0 },
  };

  it("validates data URLs and passes the decoded images to the provider", async () => {
    const provider = new MockJevProvider({ evaluate: () => noulResult });
    const core = new JevCore({ provider, defaultModel: "cloudflare/clef-flash" });

    await core.evaluate({ ...noulOnly, images: [{ data: pngDataUrl([220, 20, 20]) }] });

    const png = solidPng([220, 20, 20]);
    expect(provider.evaluateCalls[0]?.images).toEqual([
      { mediaType: "image/png", base64: png.toString("base64"), byteLength: png.byteLength },
    ]);
  });

  it("sends no images field when the input has none", async () => {
    const provider = new MockJevProvider({ evaluate: () => noulResult });
    await new JevCore({ provider, defaultModel: "m" }).evaluate(noulOnly);

    expect(provider.evaluateCalls[0]).not.toHaveProperty("images");
  });

  it("reads image paths through the injected loader", async () => {
    const provider = new MockJevProvider({ evaluate: () => noulResult });
    const loaded: string[] = [];
    const core = new JevCore({
      provider,
      defaultModel: "m",
      loadImageFile: async (path) => {
        loaded.push(path);
        return solidPng([20, 40, 220]);
      },
    });

    await core.evaluate({ ...noulOnly, images: [{ path: "/photos/blue.png" }] });

    expect(loaded).toEqual(["/photos/blue.png"]);
    expect(provider.evaluateCalls[0]?.images?.[0]?.mediaType).toBe("image/png");
  });

  it.each<[string, unknown, RegExp]>([
    ["a path when no loader is configured", [{ path: "/photos/a.png" }], /images\[0\]: image paths are disabled on this server/],
    ["an invalid data URL", [{ data: "data:image/png;base64,aGVsbG8=" }], /images\[0\]: not a PNG, JPEG or WebP image/],
    ["five images", Array.from({ length: 5 }, () => ({ data: pngDataUrl([1, 2, 3]) })), /images: must contain at most 4 images/],
    ["an empty list", [], /images: must contain at least one image when present/],
    ["a source with both data and path", [{ data: pngDataUrl([1, 2, 3]), path: "/a.png" }], /images\.0/],
    ["a remote URL source", [{ url: "https://example.com/a.png" }], /images\.0/],
  ])("rejects %s before calling the provider", async (_label, images, message) => {
    const provider = new MockJevProvider({ evaluate: () => noulResult });
    const error = await captureError(new JevCore({ provider, defaultModel: "m" }).evaluate({ ...noulOnly, images }));

    expect(error.kind).toBe("invalid_input");
    expect(error.message).toMatch(message);
    expect(provider.evaluateCalls).toHaveLength(0);
  });

  it("rejects image parts hidden in state", async () => {
    const provider = new MockJevProvider({ evaluate: () => noulResult });
    const state = [{ type: "image_url", image_url: { url: pngDataUrl([1, 2, 3]) } }, "caption"];

    const error = await captureError(new JevCore({ provider, defaultModel: "m" }).evaluate({ ...noulOnly, state }));

    expect(error.kind).toBe("invalid_input");
    expect(error.message).toMatch(/state contains an image part; pass images in the images field/);
    expect(provider.evaluateCalls).toHaveLength(0);
  });
});

describe("JevCore.evaluate input size limit", () => {
  const result: JevEvaluateResult = {
    model: "m",
    answers: { q: { type: "noul", noul: 0.5 } },
    usage: { inputTokens: 1, outputTokens: 1 },
  };
  const questions = { q: { type: "noul", instructions: "Is it ok?" } };
  const sizeOf = (state: string) => JSON.stringify({ state, questions }).length;

  it("rejects text input above maxInputChars before calling the provider", async () => {
    const provider = new MockJevProvider({ evaluate: () => result });
    const state = "x".repeat(1000);
    const core = new JevCore({ provider, defaultModel: "m", maxInputChars: sizeOf(state) - 1 });

    const error = await captureError(core.evaluate({ state, questions }));

    expect(error.kind).toBe("invalid_input");
    expect(error.message).toMatch(/text input is \d+ characters; the limit is \d+ \(JEV_MAX_INPUT_CHARS\)/);
    expect(provider.evaluateCalls).toHaveLength(0);
  });

  it("accepts input exactly at the limit", async () => {
    const provider = new MockJevProvider({ evaluate: () => result });
    const state = "x".repeat(1000);
    const core = new JevCore({ provider, defaultModel: "m", maxInputChars: sizeOf(state) });

    await expect(core.evaluate({ state, questions })).resolves.toEqual({ ...result, provider: "default" });
  });

  it("does not limit input when maxInputChars is 0 or omitted", async () => {
    const provider = new MockJevProvider({ evaluate: () => result });
    const state = "x".repeat(300_000);

    await new JevCore({ provider, defaultModel: "m", maxInputChars: 0 }).evaluate({ state, questions });
    await new JevCore({ provider, defaultModel: "m" }).evaluate({ state, questions });

    expect(provider.evaluateCalls).toHaveLength(2);
  });
});
