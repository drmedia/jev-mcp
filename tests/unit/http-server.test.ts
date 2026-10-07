import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { JevCore } from "../../src/core/jev-core.js";
import type { JevEvaluateResult } from "../../src/core/provider.js";
import { createLogger } from "../../src/observability/logger.js";
import { createJevHttpServer, HTTP_BIND_ADDRESS } from "../../src/transport/http-server.js";
import { MockJevProvider } from "../support/mock-provider.js";

const TOKEN = "t".repeat(40);

const result: JevEvaluateResult = {
  model: "jev-1.13.0",
  answers: { urgent: { type: "noul", noul: 0.93 } },
  usage: { inputTokens: 90, outputTokens: 2 },
};

let server: Server | undefined;
let client: Client | undefined;
let logLines: string[] = [];

afterEach(async () => {
  await client?.close();
  client = undefined;
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  server = undefined;
  logLines = [];
});

function answeringProvider(): MockJevProvider {
  return new MockJevProvider({
    evaluate: (request) => ({
      ...result,
      answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, result.answers.urgent!])),
    }),
  });
}

async function start(provider = answeringProvider(), maxBodyBytes?: number) {
  const core = new JevCore({ provider, defaultModel: "jev-latest" });
  const logger = createLogger("warn", (line) => logLines.push(line));
  server = createJevHttpServer({ core, token: TOKEN, logger, ...(maxBodyBytes !== undefined && { maxBodyBytes }) });
  await new Promise<void>((resolve) => server!.listen(0, HTTP_BIND_ADDRESS, () => resolve()));
  const { port } = server.address() as AddressInfo;
  return { provider, port, url: new URL(`http://127.0.0.1:${port}/mcp`) };
}

async function connect(url: URL, token = TOKEN): Promise<Client> {
  client = new Client({ name: "http-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  // The SDK's own optional property types differ under exactOptionalPropertyTypes.
  await client.connect(transport as Transport);
  return client;
}

const initialize = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw", version: "0" } },
});

/** A raw request, so Host and Origin can be set freely. */
function raw(
  port: number,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "POST",
        path: options.path ?? "/mcp",
        headers: {
          Host: `127.0.0.1:${port}`,
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...options.headers,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end(options.body ?? initialize);
  });
}

describe("Streamable HTTP server", () => {
  it("serves the same tools to an MCP client over HTTP", async () => {
    const { provider, url } = await start();
    const mcp = await connect(url);

    const { tools } = await mcp.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "jev.choice",
      "jev.evaluate",
      "jev.evaluate_batch",
      "jev.models",
      "jev.noul",
      "jev.score",
    ]);

    const call = (await mcp.callTool({
      name: "jev.noul",
      arguments: { state: "Help! My payouts have been failing for 3 days.", instructions: "Is this urgent?" },
    })) as CallToolResult;
    expect(call.isError).toBeFalsy();
    expect(call.structuredContent).toMatchObject({ model: "jev-1.13.0", answer: { type: "noul", noul: 0.93 } });
    expect(provider.evaluateCalls).toHaveLength(1);
  });

  it("answers with JSON and no session ID", async () => {
    const { port } = await start();

    const response = await raw(port, {});

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["mcp-session-id"]).toBeUndefined();
    expect(JSON.parse(response.body)).toMatchObject({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "jev-mcp" } } });
  });

  it.each([
    ["no Authorization header", { Authorization: "" }],
    ["a wrong token", { Authorization: `Bearer ${"x".repeat(40)}` }],
    ["a non-Bearer scheme", { Authorization: `Basic ${TOKEN}` }],
  ])("rejects %s with 401 and never logs the header", async (_name, headers) => {
    const { port, provider } = await start();

    const response = await raw(port, { headers });

    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toBe('Bearer realm="jev-mcp"');
    expect(JSON.parse(response.body)).toEqual({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Unauthorized: send Authorization: Bearer <JEV_HTTP_TOKEN>" },
      id: null,
    });
    expect(provider.evaluateCalls).toHaveLength(0);
    expect(logLines.join("")).not.toContain("x".repeat(40));
    expect(logLines.join("")).not.toContain(TOKEN);
  });

  it("does not accept the token in the query string", async () => {
    const { port } = await start();

    const response = await raw(port, { path: `/mcp?token=${TOKEN}`, headers: { Authorization: "" } });

    expect(response.status).toBe(401);
  });

  it.each(["evil.example.com", "evil.example.com:8098", "192.168.0.10:PORT", "127.0.0.1:1"])(
    "rejects Host %s with 403 (DNS rebinding)",
    async (host) => {
      const { port } = await start();

      const response = await raw(port, { headers: { Host: host.replace("PORT", String(port)) } });

      expect(response.status).toBe(403);
      expect(response.body).toContain("Host header must be a loopback address");
    },
  );

  it.each(["localhost", "LOCALHOST", "[::1]"])("accepts loopback Host %s", async (name) => {
    const { port } = await start();

    const response = await raw(port, { headers: { Host: `${name}:${port}` } });

    expect(response.status).toBe(200);
  });

  it("rejects a foreign Origin with 403 and accepts a loopback one", async () => {
    const { port } = await start();

    const foreign = await raw(port, { headers: { Origin: "https://evil.example.com" } });
    const loopback = await raw(port, { headers: { Origin: `http://localhost:${port}` } });

    expect(foreign.status).toBe(403);
    expect(foreign.body).toContain("Origin header must be a loopback origin");
    expect(loopback.status).toBe(200);
  });

  it.each(["GET", "DELETE"])("returns 405 for %s, since there is no SSE stream or session", async (method) => {
    const { port } = await start();

    const response = await raw(port, { method, headers: { Accept: "text/event-stream" }, body: "" });

    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("POST");
  });

  it("returns 404 outside the MCP endpoint", async () => {
    const { port } = await start();

    expect((await raw(port, { path: "/" })).status).toBe(404);
    expect((await raw(port, { path: "/mcp/extra" })).status).toBe(404);
  });

  it("rejects bodies over the size limit with 413", async () => {
    const { port, provider } = await start(undefined, 1024);

    const response = await raw(port, { body: JSON.stringify({ padding: "x".repeat(2048) }) });

    expect(response.status).toBe(413);
    expect(provider.evaluateCalls).toHaveLength(0);
  });
});
