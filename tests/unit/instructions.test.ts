import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { JevCore } from "../../src/core/jev-core.js";
import { buildServerInstructions, MAX_INSTRUCTIONS_LENGTH } from "../../src/mcp/instructions.js";
import { createJevMcpServer } from "../../src/mcp/server.js";
import { MockJevProvider } from "../support/mock-provider.js";

const all = { providerNames: ["typesafe", "openrouter", "local"], defaultProviderName: "typesafe" };

describe("buildServerInstructions", () => {
  it("covers tool choice, question writing, results, providers, images and errors", () => {
    const text = buildServerInstructions(all);

    for (const tool of ["jev.noul", "jev.choice", "jev.score", "jev.evaluate", "jev.evaluate_batch", "jev.models"]) {
      expect(text).toContain(tool);
    }
    expect(text).toContain("Near 0.5 means the question is ambiguous");
    expect(text).toContain("Providers: typesafe, openrouter, local (default typesafe).");
    expect(text).toContain("never inside `state`");
    for (const kind of ["invalid_input", "payment_required", "rate_limited", "refused", "invalid_response"]) {
      expect(text).toContain(kind);
    }
  });

  it("names only the providers this server offers", () => {
    const text = buildServerInstructions({ providerNames: ["openrouter"], defaultProviderName: "openrouter" });

    expect(text).toContain('Provider: only "openrouter" here; omit `provider`.');
    expect(text).toContain("openrouter: model required");
    expect(text).not.toContain("- typesafe:");
    expect(text).not.toContain("- local:");
  });

  it("fits within the 2048 characters Claude Code keeps, with every provider listed", () => {
    expect(buildServerInstructions(all).length).toBeLessThanOrEqual(MAX_INSTRUCTIONS_LENGTH);
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
    expect(instructions).toContain("Providers: typesafe, local (default typesafe).");
  });
});
