import { describe, expect, it } from "vitest";
import { DEFAULT_TYPESAFE_BASE_URL, loadConfig } from "../../src/config/config.js";
import { JevError } from "../../src/core/errors.js";
import { TypeSafeProvider } from "../../src/providers/typesafe/typesafe-provider.js";

const hasApiKey = Boolean(process.env.TYPESAFE_API_KEY?.trim());
const baseUrl = process.env.TYPESAFE_BASE_URL?.trim() || DEFAULT_TYPESAFE_BASE_URL;

describe("TypeSafe /v1/models contract", () => {
  it.skipIf(!hasApiKey)("lists models with the documented shape", async () => {
    const config = loadConfig();
    const provider = new TypeSafeProvider({
      apiKey: config.typesafeApiKey,
      baseUrl: config.typesafeBaseUrl,
    });

    const result = await provider.models();

    expect(result.models.length).toBeGreaterThan(0);
    for (const model of result.models) {
      expect(model.name).toEqual(expect.any(String));
      expect(model.description).toEqual(expect.any(String));
      expect(model.releaseDate).toEqual(expect.any(String));
    }
  });

  // OpenAPI documents release_date as YYYY-MM-DD; the live API returns ISO 8601
  // timestamps. This pins the observed format so a change on either side is noticed.
  it.skipIf(!hasApiKey)("returns release dates as ISO 8601 timestamps", async () => {
    const config = loadConfig();
    const provider = new TypeSafeProvider({
      apiKey: config.typesafeApiKey,
      baseUrl: config.typesafeBaseUrl,
    });

    const result = await provider.models();

    for (const model of result.models) {
      expect(model.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/);
    }
  });

  // Docs list 401 for a missing key; the live API answers 403 + authentication_error.
  // This pins the observed behavior so a change on either side is noticed.
  it("reports a missing API key as an authentication error", async () => {
    const provider = new TypeSafeProvider({ apiKey: "", baseUrl });

    const error = await provider.models().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).kind).toBe("authentication");
    expect((error as JevError).providerCode).toBe("authentication_error");
    expect([401, 403]).toContain((error as JevError).status);
  });
});
