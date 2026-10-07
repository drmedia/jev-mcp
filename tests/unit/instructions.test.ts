import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { JevCore } from "../../src/core/jev-core.js";
import { buildServerInstructions, MAX_INSTRUCTIONS_LENGTH } from "../../src/mcp/instructions.js";
import { createJevMcpServer } from "../../src/mcp/server.js";
import { MockJevProvider } from "../support/mock-provider.js";

const all = { providerNames: ["typesafe", "openrouter", "local"], defaultProviderName: "typesafe" };

describe("buildServerInstructions", () => {
  it("covers tool choice, ambiguous results, errors and providers", () => {
    const text = buildServerInstructions(all);

    for (const tool of ["jev.noul", "jev.choice", "jev.score", "jev.evaluate", "jev.evaluate_batch", "jev.models"]) {
      expect(text).toContain(tool);
    }
    expect(text).toContain("A result near 0.5 means the question is ambiguous");
    expect(text).toContain("Never substitute a guessed probability.");
    for (const kind of [
      "invalid_input",
      "invalid_request",
      "authentication",
      "authorization",
      "payment_required",
      "configuration",
      "rate_limited",
      "overloaded",
      "timeout",
      "network",
      "refused",
      "invalid_response",
      "provider_error",
    ]) {
      expect(text).toContain(kind);
    }
    expect(text).toContain(
      "Providers: typesafe, openrouter, local (default typesafe); pass `provider` and `model` to switch or compare; openrouter needs `model`; local works only while the user's local server runs.",
    );
  });

  it("names only the providers this server offers", () => {
    expect(buildServerInstructions({ providerNames: ["openrouter"], defaultProviderName: "openrouter" })).toContain(
      'Provider: only "openrouter"; omit `provider`.',
    );
    const two = buildServerInstructions({ providerNames: ["typesafe", "local"], defaultProviderName: "typesafe" });
    expect(two).toContain("Providers: typesafe, local (default typesafe)");
    expect(two).not.toContain("openrouter");
  });

  it("stays short: about half of the 2048 characters Claude Code keeps", () => {
    expect(buildServerInstructions(all).length).toBeLessThanOrEqual(MAX_INSTRUCTIONS_LENGTH / 2 + 100);
  });

  it("is free of URLs, paths and secrets", () => {
    const text = buildServerInstructions(all);

    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/[A-Za-z]:[\\/]|\/home\/|\/Users\//);
    expect(text).not.toMatch(/API_KEY|TOKEN|Bearer/);
  });
});

describe("MCP initialize", () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it("sends the instructions built from the server's providers", async () => {
    const core = new JevCore({
      provider: new MockJevProvider(),
      providerName: "typesafe",
      defaultModel: "jev-latest",
      additionalProviders: { local: { provider: new MockJevProvider(), defaultModel: "jev-latest" } },
    });
    const server = createJevMcpServer(core);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "instructions-test", version: "0.0.0" });
    await client.connect(clientTransport);

    const instructions = client.getInstructions();

    expect(instructions).toBe(buildServerInstructions({ providerNames: ["typesafe", "local"], defaultProviderName: "typesafe" }));
  });
});
