import { describe, expect, it } from "vitest";
import {
  DEFAULT_JEV_MAX_RETRIES,
  DEFAULT_JEV_MODEL,
  DEFAULT_TYPESAFE_BASE_URL,
  loadConfig,
} from "../../src/config/config.js";
import { JevError } from "../../src/core/errors.js";

describe("loadConfig", () => {
  it("applies defaults when only the API key is set", () => {
    expect(loadConfig({ TYPESAFE_API_KEY: "test-key" })).toEqual({
      typesafeApiKey: "test-key",
      typesafeBaseUrl: DEFAULT_TYPESAFE_BASE_URL,
      jevModel: DEFAULT_JEV_MODEL,
      jevMaxRetries: DEFAULT_JEV_MAX_RETRIES,
    });
  });

  it.each([
    ["0", 0],
    ["5", 5],
    [" 3 ", 3],
    ["10", 10],
    ["", DEFAULT_JEV_MAX_RETRIES],
  ])("parses JEV_MAX_RETRIES=%j as %i", (value, expected) => {
    expect(loadConfig({ TYPESAFE_API_KEY: "k", JEV_MAX_RETRIES: value }).jevMaxRetries).toBe(
      expected,
    );
  });

  it.each(["-1", "11", "1.5", "two"])("rejects JEV_MAX_RETRIES=%j", (value) => {
    expect(() => loadConfig({ TYPESAFE_API_KEY: "k", JEV_MAX_RETRIES: value })).toThrowError(
      /JEV_MAX_RETRIES must be a whole number from 0 to 10/,
    );
  });

  it("treats empty values as unset", () => {
    const config = loadConfig({
      TYPESAFE_API_KEY: "test-key",
      TYPESAFE_BASE_URL: "",
      JEV_MODEL: "  ",
    });
    expect(config.typesafeBaseUrl).toBe(DEFAULT_TYPESAFE_BASE_URL);
    expect(config.jevModel).toBe(DEFAULT_JEV_MODEL);
  });

  it("uses explicit values and strips trailing slashes from the base URL", () => {
    const config = loadConfig({
      TYPESAFE_API_KEY: "test-key",
      TYPESAFE_BASE_URL: "http://localhost:8080/",
      JEV_MODEL: "jev-1.13.0",
    });
    expect(config.typesafeBaseUrl).toBe("http://localhost:8080");
    expect(config.jevModel).toBe("jev-1.13.0");
  });

  it.each([{}, { TYPESAFE_API_KEY: "" }, { TYPESAFE_API_KEY: "   " }])(
    "rejects a missing API key (%o)",
    (env) => {
      expect(() => loadConfig(env)).toThrowError(/TYPESAFE_API_KEY is required/);
    },
  );

  it("rejects a non-http base URL without echoing secrets", () => {
    let thrown: unknown;
    try {
      loadConfig({ TYPESAFE_API_KEY: "secret-value", TYPESAFE_BASE_URL: "ftp://example.com" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(JevError);
    expect((thrown as JevError).kind).toBe("configuration");
    expect((thrown as JevError).message).toMatch(/TYPESAFE_BASE_URL/);
    expect((thrown as JevError).message).not.toContain("secret-value");
  });
});
