import { describe, expect, it } from "vitest";
import { JevError } from "../../src/core/errors.js";
import { JevCore } from "../../src/core/jev-core.js";
import { pngDataUrl } from "../support/images.js";
import { isLocalServerUp, localBaseUrlFromEnv, localProviderFromEnv } from "../support/providers-from-env.js";

// Runs only when a local System One server is reachable at JEV_LOCAL_BASE_URL
// (default http://127.0.0.1:8097), set up as in docs/local-provider.md:
// llama.cpp llama-server serving Clef Flash with its multimodal projector.
const localUp = await isLocalServerUp();

describe.skipIf(!localUp)("Local server contract (llama-server + Clef Flash)", () => {
  const core = () => new JevCore({ provider: localProviderFromEnv(), defaultModel: "clef-flash" });

  it("answers noul, choice and score questions in one request, without a cost", async () => {
    const result = await core().evaluate({
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

    expect(Object.keys(result.answers).sort()).toEqual(["department", "frustration", "is_urgent"]);
    const department = result.answers.department;
    expect(department?.type === "choice" && department.choice).toBe("billing");
    expect(result.usage.costUsd).toBeUndefined();
  });

  it("returns identical answers for identical requests", async () => {
    const input = { state: "The server room is on fire.", questions: { q: { type: "noul", instructions: "Is this an emergency?" } } };
    const first = await core().evaluate(input);
    const second = await core().evaluate(input);
    expect(second.answers).toEqual(first.answers);
  });

  it("reads PNG images sent through the images field", async () => {
    const result = await core().evaluate({
      state: "Look at the attached image.",
      questions: {
        color: {
          type: "choice",
          instructions: "What is the dominant color of the attached image?",
          criteria: { red: null, green: null, blue: null, no_image: "No image is visible" },
        },
      },
      images: [{ data: pngDataUrl([20, 40, 220]) }],
    });
    const answer = result.answers.color;
    expect(answer?.type === "choice" && answer.choice).toBe("blue");
  });

  it("lists the decision model it serves", async () => {
    const { models } = await localProviderFromEnv().models();
    expect(models.map((model) => model.name)).toContain("clef-flash");
  });

  // Measured: llama-server answers WebP with HTTP 500 "Failed to load image or audio file".
  it("cannot load WebP; the provider rejects it before sending", async () => {
    // A valid 1x1 lossless WebP, so the failure is about the format, not broken bytes.
    const webp = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
    const raw = await fetch(`${localBaseUrlFromEnv()}/v1/systemone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "clef-flash",
        state: "x",
        questions: { q: { type: "noul", instructions: "Is an image attached?" } },
        images: [webp],
      }),
    });
    expect(raw.status).toBe(500);
    expect(await raw.text()).toContain("Failed to load image");

    const error = await core()
      .evaluate({ state: "x", questions: { q: { type: "noul", instructions: "Is an image attached?" } }, images: [{ data: webp }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).kind).toBe("invalid_input");
  });
});
