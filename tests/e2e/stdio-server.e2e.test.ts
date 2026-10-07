import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

const serverPath = fileURLToPath(new URL("../../dist/transport/stdio.js", import.meta.url));
const hasApiKey = Boolean(process.env.TYPESAFE_API_KEY?.trim());
const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

/**
 * Explicit variables win over the server's own .env loading, so each test pins
 * JEV_PROVIDER and JEV_MODEL instead of inheriting whatever .env selects.
 */
function serverEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { ...getDefaultEnvironment() };
  for (const key of ["TYPESAFE_API_KEY", "TYPESAFE_BASE_URL", "OPENROUTER_API_KEY"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { JEV_PROVIDER: "typesafe", JEV_MODEL: "jev-latest", ...env, ...overrides };
}

async function connect(env: Record<string, string>): Promise<Client> {
  client = new Client({ name: "e2e-client", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: "pipe" }),
  );
  return client;
}

describe("stdio MCP server (e2e)", () => {
  it.skipIf(!hasApiKey)(
    "MCP client -> stdio -> jev.evaluate -> JevCore -> TypeSafeProvider -> TypeSafe Jev",
    async () => {
      const mcp = await connect(serverEnv({}));

      const { tools } = await mcp.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "jev.choice",
        "jev.evaluate",
        "jev.models",
        "jev.noul",
        "jev.score",
      ]);

      const models = (await mcp.callTool({ name: "jev.models", arguments: {} })) as CallToolResult;
      expect(models.isError).toBeFalsy();

      const result = (await mcp.callTool({
        name: "jev.evaluate",
        arguments: {
          state: "Help! My payouts have been failing for 3 days.",
          questions: {
            is_urgent: { type: "noul", instructions: "Does this convey urgency?" },
            frustration: {
              type: "score",
              instructions: "How frustrated is the customer?",
              criteria: ["Calm", "Frustrated", "Very angry"],
            },
          },
        },
      })) as CallToolResult;

      expect(result.isError).toBeFalsy();
      const answers = (result.structuredContent as { answers: Record<string, { type: string }> })
        .answers;
      expect(answers.is_urgent?.type).toBe("noul");
      expect(answers.frustration?.type).toBe("score");

      const choice = (await mcp.callTool({
        name: "jev.choice",
        arguments: {
          state: "Help! My payouts have been failing for 3 days.",
          instructions: "Which team should handle this?",
          criteria: { billing: "Payments, refunds", technical: "Bugs, outages", sales: null },
        },
      })) as CallToolResult;
      expect(choice.isError).toBeFalsy();
      const answer = (choice.structuredContent as { answer: { type: string; choice: string } })
        .answer;
      expect(answer.type).toBe("choice");
      expect(["billing", "technical", "sales"]).toContain(answer.choice);
    },
  );

  it.skipIf(!hasOpenRouterKey)(
    "MCP client -> stdio -> jev.noul -> JevCore -> OpenRouterProvider -> Clef",
    async () => {
      const mcp = await connect(
        serverEnv({ JEV_PROVIDER: "openrouter", JEV_MODEL: "cloudflare/clef-flash" }),
      );

      const result = (await mcp.callTool({
        name: "jev.noul",
        arguments: {
          state: "Help! My payouts have been failing for 3 days.",
          instructions: "Does this convey urgency?",
        },
      })) as CallToolResult;

      expect(result.isError).toBeFalsy();
      const content = result.structuredContent as {
        model: string;
        answer: { type: string; noul: number };
        usage: { costUsd?: number };
      };
      expect(content.model).toBe("cloudflare/clef-flash");
      expect(content.answer.type).toBe("noul");
      expect(content.usage.costUsd).toBeGreaterThan(0);

      const models = (await mcp.callTool({ name: "jev.models", arguments: {} })) as CallToolResult;
      expect(models.isError).toBeFalsy();
      const names = (models.structuredContent as { models: { name: string }[] }).models.map(
        (model) => model.name,
      );
      expect(names).toContain("cloudflare/clef-flash");
    },
  );

  it("exits with a configuration error when the API key is empty", async () => {
    // An empty variable wins over the local .env file, so the server must refuse to start.
    await expect(connect(serverEnv({ TYPESAFE_API_KEY: "" }))).rejects.toThrow();
  });
});
