import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/config.js";
import { JevCore } from "../../src/core/jev-core.js";
import { TypeSafeProvider } from "../../src/providers/typesafe/typesafe-provider.js";

const hasApiKey = Boolean(process.env.TYPESAFE_API_KEY?.trim());

describe("TypeSafe /v1/systemone contract", () => {
  it.skipIf(!hasApiKey)("answers noul, choice and score questions in one request", async () => {
    const config = loadConfig();
    const core = new JevCore({
      provider: new TypeSafeProvider({
        apiKey: config.typesafeApiKey,
        baseUrl: config.typesafeBaseUrl,
      }),
      defaultModel: config.jevModel,
    });

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
