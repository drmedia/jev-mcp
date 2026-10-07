import { describe, expect, it } from "vitest";
import { JevError } from "../../src/core/errors.js";
import { JevCore } from "../../src/core/jev-core.js";
import { OPENROUTER_MAX_TOTAL_IMAGE_BYTES } from "../../src/providers/openrouter/openrouter-provider.js";
import { noisePng, pngDataUrl } from "../support/images.js";
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

  it("Clef rejects more than 64 questions with 422; the provider stops them before sending", async () => {
    const questions = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [`q${i}`, { type: "noul" as const, instructions: `Is ${i} even?` }]),
    );

    const response = await fetch("https://openrouter.ai/api/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "cloudflare/clef-flash", state: "x", questions }),
    });
    await response.text();
    expect(response.status).toBe(422);

    const error = await openRouterProviderFromEnv()
      .evaluate({ state: "x", model: "cloudflare/clef-flash", questions })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).kind).toBe("invalid_input");
    expect((error as JevError).message).toContain("at most 64 questions per request, got 65");
  });

  it("lists decision models including Clef and Jev", async () => {
    const { models } = await openRouterProviderFromEnv().models();

    const names = models.map((model) => model.name);
    for (const model of MODELS) expect(names).toContain(model);
    for (const model of models) expect(model.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe.skipIf(!hasOpenRouterKey)("OpenRouter System One contract: images", () => {
  const questions = {
    color: {
      type: "choice" as const,
      instructions: "What is the dominant color of the attached image?",
      criteria: { red: null, green: null, blue: null, no_image: "No image is visible" },
    },
  };

  it.each([
    ["cloudflare/clef-flash", [220, 20, 20], "red"],
    ["cloudflare/clef-flash", [20, 40, 220], "blue"],
    ["cloudflare/clef", [20, 180, 40], "green"],
  ] as const)("%s sees a %j image as %s", async (model, rgb, expected) => {
    const core = new JevCore({ provider: openRouterProviderFromEnv(), defaultModel: model });

    const result = await core.evaluate({
      state: "Look at the attached image.",
      questions,
      images: [{ data: pngDataUrl([...rgb]) }],
    });

    const answer = result.answers.color;
    expect(answer?.type).toBe("choice");
    expect(answer?.type === "choice" && answer.choice).toBe(expected);
  });

  it("refuses to send an image to typesafe/jev-1.13, which reads text only", async () => {
    const core = new JevCore({ provider: openRouterProviderFromEnv(), defaultModel: "typesafe/jev-1.13" });

    const error = await core
      .evaluate({ state: "x", questions, images: [{ data: pngDataUrl([220, 20, 20]) }] })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).kind).toBe("invalid_input");
    expect((error as JevError).message).toContain("does not accept images");
  });

  // Not documented: OpenRouter estimates image tokens from the encoded size and returns
  // 413 for image totals far below Clef's documented 4 MiB per image. The limit is per
  // request, not per image. OPENROUTER_MAX_TOTAL_IMAGE_BYTES sits just below what passes.
  describe("image size limit (measured)", () => {
    async function rawStatus(images: Buffer[]): Promise<number> {
      const response = await fetch("https://openrouter.ai/api/v1/systemone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "cloudflare/clef-flash",
          state: images.map((image) => ({
            type: "image_url",
            image_url: { url: `data:image/png;base64,${image.toString("base64")}` },
          })),
          questions: { ok: { type: "noul", instructions: "Is an image attached?" } },
        }),
      });
      await response.text();
      return response.status;
    }

    it("accepts one image just below the local limit", async () => {
      const image = noisePng(355);
      expect(image.length).toBeLessThanOrEqual(OPENROUTER_MAX_TOTAL_IMAGE_BYTES);
      expect(await rawStatus([image])).toBe(200);
    });

    it("rejects one image of about 410 KB with 413", async () => {
      expect(await rawStatus([noisePng(370)])).toBe(413);
    });

    it("applies the limit to the request total: two 270 KB images are rejected with 413", async () => {
      expect(await rawStatus([noisePng(300), noisePng(300)])).toBe(413);
    });

    it("is enforced locally before sending, with an actionable message", async () => {
      const core = new JevCore({ provider: openRouterProviderFromEnv(), defaultModel: "cloudflare/clef-flash" });
      const data = `data:image/png;base64,${noisePng(370).toString("base64")}`;

      const error = await core
        .evaluate({ state: "x", questions, images: [{ data }] })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(JevError);
      expect((error as JevError).kind).toBe("invalid_input");
      expect((error as JevError).message).toContain("Resize or recompress the images");
    });
  });

  // Not in the System One reference: a top-level `images` field (Cloudflare's format)
  // is rejected, and the error names the `state` array placement this server uses.
  it("rejects a top-level images field and asks for image parts in state", async () => {
    const response = await fetch("https://openrouter.ai/api/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "cloudflare/clef-flash",
        state: "x",
        questions,
        images: [pngDataUrl([220, 20, 20])],
      }),
    });
    const body = (await response.json()) as { error?: { message?: string } };

    expect(response.status).toBe(400);
    expect(body.error?.message).toContain("Put each image in the `state` array");
  });
});

// Clef's documented request rules, which Jev does not have. The raw calls bypass the
// local check to pin the API's own behavior (rejected requests were not billed when
// measured on 2026-10-07); the provider calls show the local check stops them first.
describe.skipIf(!hasOpenRouterKey)("OpenRouter System One contract: Clef request rules", () => {
  async function rawStatus(questions: Record<string, unknown>): Promise<number> {
    const response = await fetch("https://openrouter.ai/api/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "cloudflare/clef-flash", state: "Help! Payouts failing.", questions }),
    });
    await response.text();
    return response.status;
  }

  it("Clef rejects non-ASCII question IDs with 422; the provider stops them before sending", async () => {
    expect(await rawStatus({ "긴급도": { type: "noul", instructions: "Is this urgent?" } })).toBe(422);

    const error = await openRouterProviderFromEnv()
      .evaluate({
        state: "x",
        model: "cloudflare/clef-flash",
        questions: { "긴급도": { type: "noul", instructions: "Is this urgent?" } },
      })
      .catch((e: unknown) => e);
    expect((error as JevError).kind).toBe("invalid_input");
  });

  it("Clef rejects a single-option choice with 422", async () => {
    expect(
      await rawStatus({ team: { type: "choice", instructions: "Which team?", criteria: { billing: null } } }),
    ).toBe(422);
  });

  it("Jev on OpenRouter accepts the same non-ASCII question IDs", async () => {
    const result = await openRouterProviderFromEnv().evaluate({
      state: "Help! Payouts failing.",
      model: "typesafe/jev-1.13",
      questions: { "긴급도": { type: "noul", instructions: "Is this urgent?" } },
    });
    expect(result.answers["긴급도"]?.type).toBe("noul");
  });
});
