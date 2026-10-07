import { delimiter, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_JEV_MAX_INPUT_CHARS,
  DEFAULT_JEV_MAX_RETRIES,
  DEFAULT_JEV_MODEL,
  DEFAULT_LOCAL_BASE_URL,
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_TYPESAFE_BASE_URL,
  loadConfig,
} from "../../src/config/config.js";
import { JevError } from "../../src/core/errors.js";

function configError(env: NodeJS.ProcessEnv): JevError {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).kind).toBe("configuration");
    return error as JevError;
  }
  throw new Error("expected loadConfig to throw");
}

describe("loadConfig", () => {
  it("defaults to TypeSafe when only the TypeSafe key is set", () => {
    expect(loadConfig({ TYPESAFE_API_KEY: "test-key" })).toEqual({
      provider: { name: "typesafe", apiKey: "test-key", baseUrl: DEFAULT_TYPESAFE_BASE_URL },
      jevModel: DEFAULT_JEV_MODEL,
      jevMaxRetries: DEFAULT_JEV_MAX_RETRIES,
      imageDirectories: [],
      maxInputChars: DEFAULT_JEV_MAX_INPUT_CHARS,
    });
  });

  describe("JEV_MAX_INPUT_CHARS", () => {
    it("defaults to 256,000 characters and accepts 0 to disable", () => {
      expect(DEFAULT_JEV_MAX_INPUT_CHARS).toBe(256_000);
      expect(loadConfig({ TYPESAFE_API_KEY: "k", JEV_MAX_INPUT_CHARS: "100000" }).maxInputChars).toBe(100_000);
      expect(loadConfig({ TYPESAFE_API_KEY: "k", JEV_MAX_INPUT_CHARS: "0" }).maxInputChars).toBe(0);
    });

    it.each(["-1", "1e6", "lots"])("rejects %j", (value) => {
      expect(configError({ TYPESAFE_API_KEY: "k", JEV_MAX_INPUT_CHARS: value }).message).toMatch(
        /JEV_MAX_INPUT_CHARS must be a whole number/,
      );
    });
  });

  describe("JEV_IMAGE_DIRS", () => {
    const dirA = resolve("/images/a");
    const dirB = resolve("/images/b");

    it("splits on the platform path delimiter and drops empty entries", () => {
      const config = loadConfig({
        TYPESAFE_API_KEY: "k",
        JEV_IMAGE_DIRS: ` ${dirA}${delimiter}${delimiter}${dirB} `,
      });
      expect(config.imageDirectories).toEqual([dirA, dirB]);
    });

    it("is empty (image paths disabled) when unset or blank", () => {
      expect(loadConfig({ TYPESAFE_API_KEY: "k" }).imageDirectories).toEqual([]);
      expect(loadConfig({ TYPESAFE_API_KEY: "k", JEV_IMAGE_DIRS: "  " }).imageDirectories).toEqual([]);
    });

    it("rejects relative directories", () => {
      expect(configError({ TYPESAFE_API_KEY: "k", JEV_IMAGE_DIRS: "photos" }).message).toMatch(
        /JEV_IMAGE_DIRS entries must be absolute paths/,
      );
    });
  });

  it("treats empty values as unset", () => {
    const config = loadConfig({
      JEV_PROVIDER: "",
      TYPESAFE_API_KEY: "test-key",
      TYPESAFE_BASE_URL: "",
      JEV_MODEL: "  ",
    });
    expect(config.provider).toEqual({
      name: "typesafe",
      apiKey: "test-key",
      baseUrl: DEFAULT_TYPESAFE_BASE_URL,
    });
    expect(config.jevModel).toBe(DEFAULT_JEV_MODEL);
  });

  it("uses explicit values and strips trailing slashes from the base URL", () => {
    const config = loadConfig({
      TYPESAFE_API_KEY: "test-key",
      TYPESAFE_BASE_URL: "http://localhost:8080/",
      JEV_MODEL: "jev-1.13.0",
    });
    expect(config.provider.baseUrl).toBe("http://localhost:8080");
    expect(config.jevModel).toBe("jev-1.13.0");
  });

  it.each([{}, { TYPESAFE_API_KEY: "" }, { TYPESAFE_API_KEY: "   " }])(
    "rejects a missing TypeSafe key (%o)",
    (env) => {
      expect(configError(env).message).toMatch(/TYPESAFE_API_KEY is required/);
    },
  );

  it("rejects a non-http base URL without echoing secrets", () => {
    const error = configError({
      TYPESAFE_API_KEY: "secret-value",
      TYPESAFE_BASE_URL: "ftp://example.com",
    });
    expect(error.message).toMatch(/TYPESAFE_BASE_URL/);
    expect(error.message).not.toContain("secret-value");
  });

  describe("JEV_PROVIDER", () => {
    it("selects OpenRouter with its own key and default base URL", () => {
      const config = loadConfig({
        JEV_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "sk-or-test",
        JEV_MODEL: "cloudflare/clef-flash",
      });
      expect(config.provider).toEqual({
        name: "openrouter",
        apiKey: "sk-or-test",
        baseUrl: DEFAULT_OPENROUTER_BASE_URL,
      });
      expect(config.jevModel).toBe("cloudflare/clef-flash");
    });

    it("does not require the TypeSafe key when OpenRouter is selected", () => {
      expect(() =>
        loadConfig({ JEV_PROVIDER: "openrouter", OPENROUTER_API_KEY: "sk-or-test" }),
      ).not.toThrow();
    });

    it("never falls back to another provider's key", () => {
      const error = configError({ JEV_PROVIDER: "openrouter", TYPESAFE_API_KEY: "ts-key" });
      expect(error.message).toMatch(/OPENROUTER_API_KEY is required when JEV_PROVIDER=openrouter/);
    });

    it("does not switch to OpenRouter just because its key is present", () => {
      const error = configError({ OPENROUTER_API_KEY: "sk-or-test" });
      expect(error.message).toMatch(/TYPESAFE_API_KEY is required/);
    });

    it("rejects an unknown provider", () => {
      const error = configError({ JEV_PROVIDER: "vercel", TYPESAFE_API_KEY: "k" });
      expect(error.message).toMatch(/JEV_PROVIDER must be one of: typesafe, openrouter, local/);
    });

    it("selects a local server without requiring any key", () => {
      expect(loadConfig({ JEV_PROVIDER: "local" }).provider).toEqual({
        name: "local",
        apiKey: undefined,
        baseUrl: DEFAULT_LOCAL_BASE_URL,
      });
      expect(DEFAULT_LOCAL_BASE_URL).toBe("http://127.0.0.1:8097");
    });

    it("accepts a local base URL and an optional local key", () => {
      expect(
        loadConfig({
          JEV_PROVIDER: "local",
          JEV_LOCAL_BASE_URL: "http://192.168.0.20:8097/",
          JEV_LOCAL_API_KEY: "secret",
        }).provider,
      ).toEqual({ name: "local", apiKey: "secret", baseUrl: "http://192.168.0.20:8097" });
    });

    it("rejects a local base URL ending in /v1", () => {
      expect(
        configError({ JEV_PROVIDER: "local", JEV_LOCAL_BASE_URL: "http://127.0.0.1:8097/v1" }).message,
      ).toMatch(/JEV_LOCAL_BASE_URL must be the server root without \/v1/);
    });

    it("accepts a custom OpenRouter base URL and rejects one ending in /v1", () => {
      expect(
        loadConfig({
          JEV_PROVIDER: "openrouter",
          OPENROUTER_API_KEY: "k",
          OPENROUTER_BASE_URL: "https://proxy.example.com/openrouter/",
        }).provider.baseUrl,
      ).toBe("https://proxy.example.com/openrouter");

      const error = configError({
        JEV_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "k",
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
      });
      expect(error.message).toMatch(/OPENROUTER_BASE_URL must be the API root without \/v1/);
    });
  });

  describe("JEV_MAX_RETRIES", () => {
    it.each([
      ["0", 0],
      ["5", 5],
      [" 3 ", 3],
      ["10", 10],
      ["", DEFAULT_JEV_MAX_RETRIES],
    ])("parses %j as %i", (value, expected) => {
      expect(loadConfig({ TYPESAFE_API_KEY: "k", JEV_MAX_RETRIES: value }).jevMaxRetries).toBe(
        expected,
      );
    });

    it.each(["-1", "11", "1.5", "two"])("rejects %j", (value) => {
      expect(configError({ TYPESAFE_API_KEY: "k", JEV_MAX_RETRIES: value }).message).toMatch(
        /JEV_MAX_RETRIES must be a whole number from 0 to 10/,
      );
    });
  });
});
