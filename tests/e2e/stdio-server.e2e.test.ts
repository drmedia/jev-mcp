import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { solidPng } from "../support/images.js";
import { isLocalServerUp } from "../support/providers-from-env.js";

const serverPath = fileURLToPath(new URL("../../dist/transport/stdio.js", import.meta.url));
const hasApiKey = Boolean(process.env.TYPESAFE_API_KEY?.trim());
const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());
const localUp = await isLocalServerUp();

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
  for (const key of ["TYPESAFE_API_KEY", "TYPESAFE_BASE_URL", "OPENROUTER_API_KEY", "JEV_LOCAL_BASE_URL"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { JEV_PROVIDER: "typesafe", JEV_MODEL: "jev-latest", JEV_IMAGE_DIRS: "", ...env, ...overrides };
}

/** Three text items and one image item, asked the same choice question. */
const batchWithImageArgs = {
  items: [
    { id: "payout", state: "My payout has failed three times this week and I need the money." },
    { id: "crash", state: "The mobile app crashes every time I open the settings screen." },
    { id: "thanks", state: "Just wanted to say the new dashboard looks great, thanks!" },
    {
      id: "photo",
      state: "A customer attached a photo of the damaged part they received.",
      images: [{ data: `data:image/png;base64,${solidPng([220, 20, 20]).toString("base64")}` }],
    },
  ],
  questions: {
    team: {
      type: "choice",
      instructions: "Which team should handle this customer message?",
      criteria: {
        billing: "Payments, payouts, refunds",
        technical: "Bugs, crashes, outages",
        returns: "Damaged or wrong items received",
        none: "No action needed",
      },
    },
    color: {
      type: "choice",
      instructions: "What is the dominant color of the attached image? Answer none when there is no image.",
      criteria: { red: null, green: null, blue: null, none: null },
    },
  },
};

function expectBatchWithImageAnswers(result: CallToolResult): void {
  expect(result.isError).toBeFalsy();
  const content = result.structuredContent as {
    results: { id: string; status: string; answers?: Record<string, { choice: string }> }[];
    summary: { ok: number };
  };
  expect(content.summary.ok).toBe(4);
  expect(content.results.map((item) => [item.id, item.answers?.team?.choice])).toEqual([
    ["payout", "billing"],
    ["crash", "technical"],
    ["thanks", "none"],
    ["photo", "returns"],
  ]);
  expect(content.results[3]!.answers?.color?.choice).toBe("red");
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
        "jev.evaluate_batch",
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

  it.skipIf(!hasApiKey)(
    "MCP client -> stdio -> jev.evaluate_batch -> JevCore -> TypeSafeProvider, one request per item",
    async () => {
      const mcp = await connect(serverEnv({ JEV_MAX_CONCURRENCY: "2" }));

      const result = (await mcp.callTool({
        name: "jev.evaluate_batch",
        arguments: {
          items: [
            { id: "payout", state: "My payout has failed three times this week and I need the money." },
            { id: "crash", state: "The mobile app crashes every time I open the settings screen." },
            { id: "thanks", state: "Just wanted to say the new dashboard looks great, thanks!" },
          ],
          questions: {
            team: {
              type: "choice",
              instructions: "Which team should handle this customer message?",
              criteria: {
                billing: "Payments, payouts, refunds",
                technical: "Bugs, crashes, outages",
                none: "No action needed",
              },
            },
          },
        },
      })) as CallToolResult;

      expect(result.isError).toBeFalsy();
      const content = result.structuredContent as {
        results: { id: string; status: string; answers?: { team: { choice: string } } }[];
        summary: { ok: number };
        usage: { inputTokens: number };
      };
      expect(content.summary.ok).toBe(3);
      expect(content.results.map((item) => [item.id, item.answers?.team.choice])).toEqual([
        ["payout", "billing"],
        ["crash", "technical"],
        ["thanks", "none"],
      ]);
      expect(content.usage.inputTokens).toBeGreaterThan(0);
    },
  );

  it.skipIf(!hasApiKey || !hasOpenRouterKey)(
    "one server, two providers: the same question to TypeSafe Jev and OpenRouter Clef Flash",
    async () => {
      const mcp = await connect(serverEnv({ JEV_PROVIDERS: "typesafe,openrouter" }));
      const question = {
        state: "Help! My payouts have been failing for 3 days.",
        instructions: "Does this message convey urgency?",
      };

      const jev = (await mcp.callTool({ name: "jev.noul", arguments: question })) as CallToolResult;
      const clef = (await mcp.callTool({
        name: "jev.noul",
        arguments: { ...question, provider: "openrouter", model: "cloudflare/clef-flash" },
      })) as CallToolResult;
      const missingModel = (await mcp.callTool({
        name: "jev.noul",
        arguments: { ...question, provider: "openrouter" },
      })) as CallToolResult;
      const models = (await mcp.callTool({ name: "jev.models", arguments: {} })) as CallToolResult;

      expect(jev.structuredContent).toMatchObject({ provider: "typesafe", answer: { type: "noul" } });
      expect(clef.structuredContent).toMatchObject({ provider: "openrouter", model: "cloudflare/clef-flash" });
      expect((clef.structuredContent as { usage: { costUsd?: number } }).usage.costUsd).toBeGreaterThan(0);
      expect(missingModel.isError).toBe(true);
      const listed = (models.structuredContent as { models: { name: string; provider: string }[] }).models;
      expect(new Set(listed.map((model) => model.provider))).toEqual(new Set(["typesafe", "openrouter"]));
      expect(listed).toContainEqual(expect.objectContaining({ name: "cloudflare/clef-flash", provider: "openrouter" }));
    },
  );

  it.skipIf(!hasOpenRouterKey)(
    "MCP client -> stdio -> jev.evaluate_batch with a per-item image -> OpenRouterProvider -> Clef Flash",
    async () => {
      const mcp = await connect(
        serverEnv({ JEV_PROVIDER: "openrouter", JEV_MODEL: "cloudflare/clef-flash", JEV_MAX_CONCURRENCY: "2" }),
      );

      const result = (await mcp.callTool({ name: "jev.evaluate_batch", arguments: batchWithImageArgs })) as CallToolResult;

      expectBatchWithImageAnswers(result);
      const content = result.structuredContent as {
        results: { model: string; usage: { costUsd?: number } }[];
        usage: { costUsd?: number };
      };
      expect(content.results.every((item) => item.model === "cloudflare/clef-flash")).toBe(true);
      expect(content.usage.costUsd).toBeGreaterThan(0);
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

  it.skipIf(!hasOpenRouterKey)(
    "reads an image file from JEV_IMAGE_DIRS and sends it to Clef; paths outside are refused",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "jev-e2e-images-"));
      const outside = await mkdtemp(join(tmpdir(), "jev-e2e-outside-"));
      try {
        await writeFile(join(dir, "part.png"), solidPng([220, 20, 20]));
        await writeFile(join(outside, "secret.png"), solidPng([20, 40, 220]));
        const mcp = await connect(
          serverEnv({
            JEV_PROVIDER: "openrouter",
            JEV_MODEL: "cloudflare/clef-flash",
            JEV_IMAGE_DIRS: dir,
          }),
        );
        const question = {
          state: "Inspection photo of a part.",
          instructions: "What is the dominant color of the attached image?",
          criteria: { red: null, green: null, blue: null },
        };

        const inside = (await mcp.callTool({
          name: "jev.choice",
          arguments: { ...question, images: [{ path: join(dir, "part.png") }] },
        })) as CallToolResult;
        expect(inside.isError).toBeFalsy();
        expect((inside.structuredContent as { answer: { choice: string } }).answer.choice).toBe("red");

        const refused = (await mcp.callTool({
          name: "jev.choice",
          arguments: { ...question, images: [{ path: join(outside, "secret.png") }] },
        })) as CallToolResult;
        expect(refused.isError).toBe(true);
        expect(JSON.stringify(refused.content)).toContain("outside the directories allowed by JEV_IMAGE_DIRS");
      } finally {
        await rm(dir, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    },
  );

  it("exits with a configuration error when the API key is empty", async () => {
    // An empty variable wins over the local .env file, so the server must refuse to start.
    await expect(connect(serverEnv({ TYPESAFE_API_KEY: "" }))).rejects.toThrow();
  });
});

describe("stdio MCP server with a local provider (e2e)", () => {
  it.skipIf(!localUp)(
    "MCP client -> stdio -> jev.choice with an image path -> LocalProvider -> local Clef Flash",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "jev-e2e-local-"));
      try {
        await writeFile(join(dir, "part.png"), solidPng([220, 20, 20]));
        const mcp = await connect(
          serverEnv({ JEV_PROVIDER: "local", JEV_MODEL: "clef-flash", JEV_IMAGE_DIRS: dir }),
        );

        const result = (await mcp.callTool({
          name: "jev.choice",
          arguments: {
            state: "Inspection photo of a part.",
            instructions: "What is the dominant color of the attached image?",
            criteria: { red: null, green: null, blue: null },
            images: [{ path: join(dir, "part.png") }],
          },
        })) as CallToolResult;

        expect(result.isError).toBeFalsy();
        expect((result.structuredContent as { answer: { choice: string } }).answer.choice).toBe("red");

        const models = (await mcp.callTool({ name: "jev.models", arguments: {} })) as CallToolResult;
        expect((models.structuredContent as { models: { name: string }[] }).models.map((m) => m.name)).toContain(
          "clef-flash",
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!localUp)(
    "MCP client -> stdio -> jev.evaluate_batch with a per-item image -> LocalProvider -> local Clef Flash",
    async () => {
      const mcp = await connect(serverEnv({ JEV_PROVIDER: "local", JEV_MODEL: "clef-flash", JEV_MAX_CONCURRENCY: "2" }));

      const result = (await mcp.callTool({ name: "jev.evaluate_batch", arguments: batchWithImageArgs })) as CallToolResult;

      expectBatchWithImageAnswers(result);
      expect((result.structuredContent as { usage: object }).usage).not.toHaveProperty("costUsd");
    },
  );
});
