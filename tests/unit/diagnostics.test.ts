import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { JevError } from "../../src/core/errors.js";
import { JevCore } from "../../src/core/jev-core.js";
import { createLogger } from "../../src/observability/logger.js";
import { createProvider } from "../../src/providers/create-provider.js";
import { MockJevProvider } from "../support/mock-provider.js";

const input = {
  state: "Help! My payouts have been failing for 3 days.",
  questions: { urgent: { type: "noul", instructions: "Does this convey urgency?" } },
};

function coreWithLog(provider: MockJevProvider, level: "warn" | "debug") {
  const lines: string[] = [];
  const core = new JevCore({
    provider,
    defaultModel: "jev-latest",
    logger: createLogger(level, (line) => lines.push(line)),
  });
  return { core, lines };
}

describe("JevCore diagnostics", () => {
  it("logs the provider payload when answers do not match the questions", async () => {
    const provider = new MockJevProvider({
      evaluate: () => ({ model: "m", answers: { other: { type: "noul", noul: 0.4 } }, usage: { inputTokens: 1, outputTokens: 0 } }),
    });
    const { core, lines } = coreWithLog(provider, "warn");

    await expect(core.evaluate(input)).rejects.toMatchObject({ kind: "invalid_response" });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[jev-mcp] warn: Invalid provider response: Provider answers do not match the questions");
    expect(lines[0]).toContain('"other":{"type":"noul","noul":0.4}');
  });

  it("logs a structurally invalid provider body", async () => {
    const provider = new MockJevProvider({
      evaluate: () => {
        throw new JevError("invalid_response", "TypeSafe System One response failed validation", {
          details: { issues: [], body: { answers: "not an object" } },
        });
      },
    });
    const { core, lines } = coreWithLog(provider, "warn");

    await expect(core.evaluate(input)).rejects.toMatchObject({ kind: "invalid_response" });

    expect(lines[0]).toContain('Provider payload: {"issues":[],"body":{"answers":"not an object"}}');
  });

  it("does not log other provider errors at the default level", async () => {
    const provider = new MockJevProvider({
      evaluate: () => {
        throw new JevError("rate_limited", "slow down", { status: 429 });
      },
    });
    const { core, lines } = coreWithLog(provider, "warn");

    await expect(core.evaluate(input)).rejects.toMatchObject({ kind: "rate_limited" });

    expect(lines).toEqual([]);
  });

  it("logs each provider request at debug, without state or questions text", async () => {
    const provider = new MockJevProvider({
      evaluate: () => ({
        model: "jev-1.13.0",
        answers: { urgent: { type: "noul", noul: 0.9 } },
        usage: { inputTokens: 120, outputTokens: 3, costUsd: 0.0001 },
      }),
    });
    const { core, lines } = coreWithLog(provider, "debug");

    await core.evaluate(input);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\[jev-mcp\] debug: evaluate provider=default model=jev-latest questions=1 images=0 ok in \d+ ms \(answered by jev-1\.13\.0, tokens 120\/3, cost 0\.0001 USD\)\n$/,
    );
    expect(lines[0]).not.toContain("payouts");
    expect(lines[0]).not.toContain("urgency");
  });
});

describe("createProvider timeout", () => {
  let server: Server | undefined;

  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  it("applies the configured timeout to provider requests", async () => {
    // Accepts connections and never answers.
    server = createServer(() => {});
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;

    const provider = createProvider({ name: "local", apiKey: undefined, baseUrl: `http://127.0.0.1:${port}` }, { timeoutMs: 1000 });

    await expect(provider.models()).rejects.toMatchObject({
      kind: "timeout",
      message: "Local server request timed out after 1000 ms",
    });
  });
});
