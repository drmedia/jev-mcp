import { describe, expect, it } from "vitest";
import { JevError } from "../../src/core/errors.js";
import { JevCore } from "../../src/core/jev-core.js";
import { hasOpenRouterKey, openRouterProviderFromEnv } from "../support/providers-from-env.js";

// OpenRouter System One API behavior observed on 2026-10-07; see docs/openrouter-notes.md.

const MODELS = ["cloudflare/clef", "cloudflare/clef-flash", "typesafe/jev-1.13"] as const;

describe.skipIf(!hasOpenRouterKey)("OpenRouter System One contract", () => {
  it.each(MODELS)(
    "%s answers noul, choice and score questions in one request and reports its cost",
    async (model) => {
      // JevCore validates the answers against the questions; reaching the assertions
      // means every answer was present, typed correctly and within range.
      const core = new JevCore({ provider: openRouterProviderFromEnv(), defaultModel: model });

      const result = await core.evaluate({
        state: "Help! My payouts have been failing for 3 days.",
        questions: {
          is_urgent: { type: "noul", instructions: "Does this convey urgency?" },
          department: {
            type: "choice",
            instructions: "Which team should handle this?",
            criteria: { billing: "Payments, refunds", technical: "Bugs, outages", sales: null },
          },
          frustration: {
            type: "score",
            instructions: "How frustrated is the customer?",
            criteria: ["Calm", "Frustrated", "Very angry"],
          },
        },
      });

      expect(result.model.startsWith(model)).toBe(true);
      expect(Object.keys(result.answers).sort()).toEqual(["department", "frustration", "is_urgent"]);
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(result.usage.costUsd).toBeGreaterThan(0);
    },
  );

  it("maps bare Jev IDs such as jev-latest onto typesafe/", async () => {
    const result = await openRouterProviderFromEnv().evaluate({
      state: "Hello there!",
      model: "jev-latest",
      questions: { q: { type: "noul", instructions: "Is this a greeting?" } },
    });

    expect(result.model.startsWith("typesafe/jev-")).toBe(true);
  });

  it("does not map bare Clef IDs: clef-flash becomes typesafe/clef-flash and fails", async () => {
    const error = await openRouterProviderFromEnv()
      .evaluate({
        state: "x",
        model: "clef-flash",
        questions: { q: { type: "noul", instructions: "Is this text?" } },
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).kind).toBe("invalid_request");
    expect((error as JevError).status).toBe(400);
    expect((error as JevError).message).toContain("typesafe/clef-flash does not exist");
  });

  it("rejects more than 64 questions for Clef as invalid_request", async () => {
    const questions = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [`q${i}`, { type: "noul" as const, instructions: `Is ${i} even?` }]),
    );

    const error = await openRouterProviderFromEnv()
      .evaluate({ state: "x", model: "cloudflare/clef-flash", questions })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).kind).toBe("invalid_request");
    expect((error as JevError).status).toBe(422);
  });

  it("lists decision models including Clef and Jev", async () => {
    const { models } = await openRouterProviderFromEnv().models();

    const names = models.map((model) => model.name);
    for (const model of MODELS) expect(names).toContain(model);
    for (const model of models) expect(model.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
