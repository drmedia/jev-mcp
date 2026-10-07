import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { JevError } from "../../src/core/errors.js";
import { JevCore } from "../../src/core/jev-core.js";
import type { JevEvaluateRequest, JevEvaluateResult } from "../../src/core/provider.js";
import { createJevMcpServer } from "../../src/mcp/server.js";
import { MockJevProvider } from "../support/mock-provider.js";

const questions = { urgent: { type: "noul", instructions: "Is this urgent?" } };

function answering(model: string, noul: number): MockJevProvider {
  return new MockJevProvider({
    evaluate: (request: JevEvaluateRequest): JevEvaluateResult => ({
      model: request.model === "jev-latest" ? model : request.model,
      answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, { type: "noul" as const, noul }])),
      usage: { inputTokens: 10, outputTokens: 1 },
    }),
    models: () => ({ models: [{ name: `${model}-listed` }] }),
  });
}

function routingCore() {
  const typesafe = answering("jev-1.13.0", 0.9);
  const openrouter = answering("unused", 0.7);
  const local = answering("clef-flash", 0.6);
  const core = new JevCore({
    provider: typesafe,
    providerName: "typesafe",
    defaultModel: "jev-latest",
    additionalProviders: {
      openrouter: { provider: openrouter },
      local: { provider: local, defaultModel: "jev-latest" },
    },
  });
  return { core, typesafe, openrouter, local };
}

async function captureError(promise: Promise<unknown>): Promise<JevError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(JevError);
    return error as JevError;
  }
  throw new Error("expected promise to reject");
}

describe("JevCore provider selection", () => {
  it("uses the default provider when none is named, and tags the result", async () => {
    const { core, typesafe, openrouter } = routingCore();

    const result = await core.evaluate({ state: "s", questions });

    expect(result).toMatchObject({ provider: "typesafe", model: "jev-1.13.0" });
    expect(typesafe.evaluateCalls).toHaveLength(1);
    expect(openrouter.evaluateCalls).toHaveLength(0);
    expect(core.providerNames).toEqual(["typesafe", "openrouter", "local"]);
    expect(core.defaultProviderName).toBe("typesafe");
  });

  it("sends to the named provider with the requested model", async () => {
    const { core, typesafe, openrouter } = routingCore();

    const result = await core.evaluate({ state: "s", questions, provider: "openrouter", model: "cloudflare/clef-flash" });

    expect(result).toMatchObject({ provider: "openrouter", model: "cloudflare/clef-flash" });
    expect(openrouter.evaluateCalls[0]!.model).toBe("cloudflare/clef-flash");
    expect(typesafe.evaluateCalls).toHaveLength(0);
  });

  it("uses a provider's own default model, never the default provider's", async () => {
    const { core, local } = routingCore();

    await core.evaluate({ state: "s", questions, provider: "local" });

    expect(local.evaluateCalls[0]!.model).toBe("jev-latest");
  });

  it("requires a model for a provider without a default model, before sending", async () => {
    const { core, openrouter } = routingCore();

    const error = await captureError(core.evaluate({ state: "s", questions, provider: "openrouter" }));

    expect(error.kind).toBe("invalid_input");
    expect(error.message).toBe(
      "Invalid evaluate input: model is required when provider is openrouter; jev.models lists its models",
    );
    expect(openrouter.evaluateCalls).toHaveLength(0);
  });

  it("rejects an unknown provider, naming the available ones", async () => {
    const { core, typesafe } = routingCore();

    const error = await captureError(core.evaluate({ state: "s", questions, provider: "anthropic" }));

    expect(error.kind).toBe("invalid_input");
    expect(error.message).toBe(
      'Unknown provider "anthropic"; this server offers: typesafe, openrouter, local (JEV_PROVIDERS adds more)',
    );
    expect(typesafe.evaluateCalls).toHaveLength(0);
  });

  it("sends every batch item to the named provider", async () => {
    const { core, local, typesafe } = routingCore();

    const result = await core.evaluateBatch({ items: [{ state: "a" }, { state: "b" }], questions, provider: "local" });

    expect(result.provider).toBe("local");
    expect(result.summary.ok).toBe(2);
    expect(local.evaluateCalls).toHaveLength(2);
    expect(typesafe.evaluateCalls).toHaveLength(0);
  });

  it("rejects a batch for an unknown provider before sending anything", async () => {
    const { core, typesafe } = routingCore();

    const error = await captureError(core.evaluateBatch({ items: [{ state: "a" }], questions, provider: "nope" }));

    expect(error.message).toMatch(/^items\[0\]: Unknown provider "nope"/);
    expect(typesafe.evaluateCalls).toHaveLength(0);
  });
});

describe("JevCore.models across providers", () => {
  it("lists every provider's models, tagged with the provider", async () => {
    const { core } = routingCore();

    await expect(core.models()).resolves.toEqual({
      models: [
        { name: "jev-1.13.0-listed", provider: "typesafe" },
        { name: "unused-listed", provider: "openrouter" },
        { name: "clef-flash-listed", provider: "local" },
      ],
    });
  });

  it("lists one provider when named", async () => {
    const { core } = routingCore();

    await expect(core.models(undefined, "local")).resolves.toEqual({
      models: [{ name: "clef-flash-listed", provider: "local" }],
    });
  });

  it("reports an unreachable provider instead of failing the whole list", async () => {
    const down = new MockJevProvider({
      models: () => {
        throw new JevError("network", "Could not reach the Local server API (ECONNREFUSED)");
      },
    });
    const core = new JevCore({
      provider: answering("jev-1.13.0", 0.9),
      providerName: "typesafe",
      defaultModel: "jev-latest",
      additionalProviders: { local: { provider: down } },
    });

    await expect(core.models()).resolves.toEqual({
      models: [{ name: "jev-1.13.0-listed", provider: "typesafe" }],
      errors: [{ provider: "local", kind: "network", message: "Could not reach the Local server API (ECONNREFUSED)" }],
    });
  });

  it("fails when every requested provider fails", async () => {
    const down = new MockJevProvider({
      models: () => {
        throw new JevError("authentication", "bad key");
      },
    });
    const core = new JevCore({ provider: down, providerName: "typesafe", defaultModel: "jev-latest" });

    const error = await captureError(core.models());

    expect(error.kind).toBe("authentication");
  });
});

describe("MCP tools with several providers", () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  async function connect(core: JevCore): Promise<Client> {
    const server = createJevMcpServer(core);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "routing-test", version: "0.0.0" });
    await client.connect(clientTransport);
    return client;
  }

  it("names the available providers in every question tool's description", async () => {
    const { tools } = await (await connect(routingCore().core)).listTools();

    for (const name of ["jev.evaluate", "jev.evaluate_batch", "jev.noul", "jev.choice", "jev.score", "jev.models"]) {
      const tool = tools.find((candidate) => candidate.name === name)!;
      expect(tool.description).toContain('"typesafe", "openrouter", "local" (default "typesafe")');
    }
    const noul = tools.find((tool) => tool.name === "jev.noul")!;
    expect(noul.inputSchema.properties).toHaveProperty("provider");
    expect(noul.inputSchema.required).not.toContain("provider");
  });

  it("routes a convenience tool by provider and reports it in the result", async () => {
    const { core, local } = routingCore();
    const mcp = await connect(core);

    const result = (await mcp.callTool({
      name: "jev.noul",
      arguments: { state: "s", instructions: "Is this urgent?", provider: "local" },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ provider: "local", model: "clef-flash", answer: { noul: 0.6 } });
    expect(local.evaluateCalls).toHaveLength(1);
  });

  it("jev.models takes an optional provider", async () => {
    const mcp = await connect(routingCore().core);

    const result = (await mcp.callTool({ name: "jev.models", arguments: { provider: "openrouter" } })) as CallToolResult;

    expect(result.structuredContent).toEqual({ models: [{ name: "unused-listed", provider: "openrouter" }] });
  });

  it("says when only one provider is offered", async () => {
    const core = new JevCore({ provider: answering("m", 0.5), providerName: "typesafe", defaultModel: "jev-latest" });
    const { tools } = await (await connect(core)).listTools();

    expect(tools.find((tool) => tool.name === "jev.evaluate")!.description).toContain(
      'this server offers only "typesafe"',
    );
  });
});
