import { describe, expect, it } from "vitest";
import { JevError } from "../../src/core/errors.js";
import { JevCore } from "../../src/core/jev-core.js";
import { hasTypeSafeKey as hasApiKey, typesafeProviderFromEnv } from "../support/providers-from-env.js";

describe("TypeSafe /v1/systemone contract", () => {
  // The docs list no 400 response; the live API answers an unknown model with
  // 400 + api_usage_error. This pins the observed behavior and its error mapping.
  it.skipIf(!hasApiKey)("rejects an unknown model with HTTP 400 as invalid_request", async () => {
    const provider = typesafeProviderFromEnv();

    const error = await provider
      .evaluate({
        state: "x",
        model: "jev-model-that-does-not-exist",
        questions: { q: { type: "noul", instructions: "Is this text?" } },
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).kind).toBe("invalid_request");
    expect((error as JevError).status).toBe(400);
    expect((error as JevError).providerCode).toBe("api_usage_error");
    expect((error as JevError).message).toContain("Unknown model");
  });

  it.skipIf(!hasApiKey)("answers noul, choice and score questions in one request", async () => {
    const core = new JevCore({ provider: typesafeProviderFromEnv(), defaultModel: "jev-latest" });

    // JevCore validates the answers against the questions; reaching the assertions
    // means every answer was present, typed correctly and within range.
    const result = await core.evaluate({
      state: "Help! My payouts have been failing for 3 days.",
      questions: {
        is_urgent: { type: "noul", instructions: "Does this convey urgency?" },
        department: {
          type: "choice",
          instructions: "Which team should handle this?",
          criteria: {
            billing: "Payments, invoicing, refunds",
            technical: "Bugs, outages, integrations",
            sales: "Pricing, upgrades, new accounts",
          },
        },
        frustration: {
          type: "score",
          instructions: "How frustrated is the customer?",
          criteria: ["Calm", "Frustrated", "Very angry"],
        },
      },
    });

    expect(result.model).toEqual(expect.any(String));
    expect(Object.keys(result.answers).sort()).toEqual(["department", "frustration", "is_urgent"]);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThanOrEqual(0);
  });
});

describe("TypeSafe /v1/systemone contract: long input", () => {
  // About 40k tokens of state: above the documented 32k for state plus the longest
  // question. TypeSafe rejects it (not billed) with only an error type in the body.
  it.skipIf(!hasApiKey)("rejects an oversized state with max_tokens_exceeded in the message", async () => {
    const state = Array.from({ length: 2700 }, (_, i) => `Log line ${i}: routine status check passed.`).join("\n");

    const error = await typesafeProviderFromEnv()
      .evaluate({ state, model: "jev-latest", questions: { q: { type: "noul", instructions: "Is this a log?" } } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).kind).toBe("invalid_request");
    expect((error as JevError).message).toBe("TypeSafe API returned HTTP 400: max_tokens_exceeded");
  });
});
