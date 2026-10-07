import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JevError } from "../../src/core/errors.js";
import { JevCore } from "../../src/core/jev-core.js";
import type { JevEvaluateResult } from "../../src/core/provider.js";
import { createJevMcpServer } from "../../src/mcp/server.js";
import { MockJevProvider } from "../support/mock-provider.js";

const evaluateArgs = {
  state: "Help! My payouts have been failing for 3 days.",
  questions: {
    is_urgent: { type: "noul", instructions: "Does this convey urgency?" },
    department: {
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: { billing: null, technical: null },
    },
  },
};

const evaluateResult: JevEvaluateResult = {
  model: "jev-1.13.0",
  answers: {
    is_urgent: { type: "noul", noul: 0.95 },
    department: {
      type: "choice",
      choice: "billing",
      confidence: 0.81,
      probabilities: { billing: 0.88, technical: 0.12 },
    },
  },
  usage: { inputTokens: 318, outputTokens: 34 },
};

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function connect(provider: MockJevProvider): Promise<Client> {
  const server = createJevMcpServer(new JevCore({ provider, defaultModel: "jev-latest" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function errorBody(result: CallToolResult): { kind: string; message: string; status?: number } {
  expect(result.isError).toBe(true);
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  return (JSON.parse(text) as { error: { kind: string; message: string; status?: number } }).error;
}

describe("MCP tools", () => {
  it("lists all JEV tools with input and output schemas", async () => {
    const mcp = await connect(new MockJevProvider());

    const { tools } = await mcp.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "jev.choice",
      "jev.evaluate",
      "jev.models",
      "jev.noul",
      "jev.score",
    ]);
    for (const tool of tools) expect(tool.outputSchema).toBeDefined();
    const evaluate = tools.find((tool) => tool.name === "jev.evaluate")!;
    expect(evaluate.inputSchema.required).toEqual(["state", "questions"]);
    expect(evaluate.outputSchema?.properties).toHaveProperty("answers");
    expect(evaluate.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("jev.evaluate returns structured answers through JevCore", async () => {
    const provider = new MockJevProvider({ evaluate: () => evaluateResult });
    const mcp = await connect(provider);

    const result = (await mcp.callTool({
      name: "jev.evaluate",
      arguments: evaluateArgs,
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(evaluateResult);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(evaluateResult);
    expect(provider.evaluateCalls[0]?.model).toBe("jev-latest");
  });

  it("jev.evaluate rejects malformed questions without calling the provider", async () => {
    const provider = new MockJevProvider({ evaluate: () => evaluateResult });
    const mcp = await connect(provider);

    const result = (await mcp.callTool({
      name: "jev.evaluate",
      arguments: {
        state: "x",
        questions: { q: { type: "score", instructions: "x", criteria: ["one"] } },
      },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("at least 2 levels");
    expect(provider.evaluateCalls).toHaveLength(0);
  });

  it("jev.evaluate reports provider errors without inventing answers", async () => {
    const mcp = await connect(
      new MockJevProvider({
        evaluate: () => {
          throw new JevError("rate_limited", "TypeSafe API returned HTTP 429", {
            status: 429,
            retryAfterSeconds: 3,
          });
        },
      }),
    );

    const result = (await mcp.callTool({
      name: "jev.evaluate",
      arguments: evaluateArgs,
    })) as CallToolResult;

    expect(result.structuredContent).toBeUndefined();
    expect(errorBody(result)).toEqual({
      kind: "rate_limited",
      message: "TypeSafe API returned HTTP 429",
      status: 429,
      retryAfterSeconds: 3,
    });
  });

  it("hides unexpected internal errors behind a generic message and logs to stderr", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mcp = await connect(
      new MockJevProvider({
        evaluate: () => {
          throw new Error("secret internal detail");
        },
      }),
    );

    const result = (await mcp.callTool({
      name: "jev.evaluate",
      arguments: evaluateArgs,
    })) as CallToolResult;

    expect(errorBody(result)).toEqual({ kind: "internal", message: "Unexpected server error" });
    expect(String(stderr.mock.calls[0]?.[0])).toContain("secret internal detail");
    stderr.mockRestore();
  });

  describe("convenience tools", () => {
    const state = "Help! My payouts have been failing for 3 days.";
    const usage = { inputTokens: 100, outputTokens: 10 };

    it.each([
      {
        tool: "jev.noul",
        args: {
          state,
          instructions: "Does this convey urgency?",
          criteria: { true: "Explicitly time-sensitive" },
        },
        question: {
          type: "noul",
          instructions: "Does this convey urgency?",
          criteria: { true: "Explicitly time-sensitive" },
        },
        answer: { type: "noul" as const, noul: 0.95 },
      },
      {
        tool: "jev.choice",
        args: {
          state,
          model: "jev-1.13.0",
          instructions: "Which team?",
          criteria: { billing: null, technical: "Bugs" },
        },
        question: {
          type: "choice",
          instructions: "Which team?",
          criteria: { billing: null, technical: "Bugs" },
        },
        answer: {
          type: "choice" as const,
          choice: "billing",
          confidence: 0.8,
          probabilities: { billing: 0.9, technical: 0.1 },
        },
      },
      {
        tool: "jev.score",
        args: { state, instructions: "How frustrated?", criteria: ["Calm", "Angry"] },
        question: { type: "score", instructions: "How frustrated?", criteria: ["Calm", "Angry"] },
        answer: {
          type: "score" as const,
          score: 0.9,
          confidence: 0.7,
          legend: { "0": "Calm", "1": "Angry" },
          probabilities: { "0": 0.1, "1": 0.9 },
        },
      },
    ])("$tool sends one question through JevCore and returns its answer", async (c) => {
      const provider = new MockJevProvider({
        evaluate: (request) => ({
          model: "jev-1.13.0",
          answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, c.answer])),
          usage,
        }),
      });
      const mcp = await connect(provider);

      const result = (await mcp.callTool({ name: c.tool, arguments: c.args })) as CallToolResult;

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ model: "jev-1.13.0", answer: c.answer, usage });
      expect(provider.evaluateCalls).toHaveLength(1);
      const request = provider.evaluateCalls[0]!;
      expect(request.state).toBe(state);
      expect(request.model).toBe("model" in c.args ? c.args.model : "jev-latest");
      expect(Object.values(request.questions)).toEqual([c.question]);
    });

    it.each([
      ["jev.noul without instructions", "jev.noul", { state }],
      ["jev.choice without criteria", "jev.choice", { state, instructions: "x" }],
      ["jev.score with one level", "jev.score", { state, instructions: "x", criteria: ["one"] }],
      ["an unknown field", "jev.noul", { state, instructions: "x", type: "noul" }],
    ])("rejects %s without calling the provider", async (_label, tool, args) => {
      const provider = new MockJevProvider({ evaluate: () => evaluateResult });
      const mcp = await connect(provider);

      const result = (await mcp.callTool({ name: tool, arguments: args })) as CallToolResult;

      expect(result.isError).toBe(true);
      expect(provider.evaluateCalls).toHaveLength(0);
    });

    it("reports provider errors as tool errors", async () => {
      const mcp = await connect(
        new MockJevProvider({
          evaluate: () => {
            throw new JevError("authentication", "TypeSafe API returned HTTP 401", { status: 401 });
          },
        }),
      );

      const result = (await mcp.callTool({
        name: "jev.noul",
        arguments: { state, instructions: "x" },
      })) as CallToolResult;

      expect(errorBody(result)).toEqual({
        kind: "authentication",
        message: "TypeSafe API returned HTTP 401",
        status: 401,
      });
    });

    it("rejects a mismatched provider answer instead of returning it", async () => {
      const mcp = await connect(
        new MockJevProvider({
          evaluate: (request) => ({
            model: "jev-1.13.0",
            answers: Object.fromEntries(
              Object.keys(request.questions).map((id) => [id, { type: "noul", noul: 0.5 }]),
            ),
            usage,
          }),
        }),
      );

      const result = (await mcp.callTool({
        name: "jev.score",
        arguments: { state, instructions: "x", criteria: ["a", "b"] },
      })) as CallToolResult;

      expect(errorBody(result).kind).toBe("invalid_response");
    });
  });

  it("jev.models returns the provider's models", async () => {
    const models = { models: [{ name: "jev-latest", description: "d", releaseDate: "2026-09-15" }] };
    const mcp = await connect(new MockJevProvider({ models: () => models }));

    const result = (await mcp.callTool({ name: "jev.models", arguments: {} })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(models);
  });
});
