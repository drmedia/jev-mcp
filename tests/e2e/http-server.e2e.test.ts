import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

const serverPath = fileURLToPath(new URL("../../dist/transport/http.js", import.meta.url));
const hasApiKey = Boolean(process.env.TYPESAFE_API_KEY?.trim());

let child: ChildProcess | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
  child?.kill();
  child = undefined;
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

function serverEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { ...getDefaultEnvironment() };
  const key = process.env.TYPESAFE_API_KEY;
  if (key !== undefined) env.TYPESAFE_API_KEY = key;
  return { JEV_PROVIDER: "typesafe", JEV_MODEL: "jev-latest", JEV_IMAGE_DIRS: "", ...env, ...overrides };
}

/** Starts the built HTTP server and resolves once it reports that it is listening. */
function startServer(env: Record<string, string>): Promise<{ stderr: () => string }> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child = spawn(process.execPath, [serverPath], { env, stdio: ["ignore", "pipe", "pipe"] });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.includes("Listening on")) resolve({ stderr: () => stderr });
    });
    child.once("exit", (code) => reject(new Error(`server exited with ${code}: ${stderr}`)));
  });
}

function exitOf(env: Record<string, string>): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    let stderr = "";
    let stdout = "";
    child = spawn(process.execPath, [serverPath], { env, stdio: ["ignore", "pipe", "pipe"] });
    child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdout!.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.once("exit", (code) => resolve({ code, stderr, stdout }));
  });
}

async function connect(port: number, token: string): Promise<Client> {
  client = new Client({ name: "e2e-http-client", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  // The SDK's own optional property types differ under exactOptionalPropertyTypes.
  await client.connect(transport as Transport);
  return client;
}

describe("Streamable HTTP server (e2e)", () => {
  it("exits with a configuration error when JEV_HTTP_TOKEN is missing", async () => {
    const { code, stderr, stdout } = await exitOf(serverEnv({ JEV_PROVIDER: "local", JEV_HTTP_TOKEN: "" }));

    expect(code).toBe(1);
    expect(stderr).toContain("JEV_HTTP_TOKEN is required for the HTTP server");
    expect(stdout).toBe("");
  });

  it("lists the tools over HTTP without contacting a provider, and never prints the token", async () => {
    const port = await freePort();
    const token = randomBytes(32).toString("hex");
    const server = await startServer(
      serverEnv({ JEV_PROVIDER: "local", PORT: String(port), JEV_HTTP_TOKEN: token, JEV_LOG_LEVEL: "info" }),
    );

    const mcp = await connect(port, token);
    const { tools } = await mcp.listTools();

    expect(tools.map((tool) => tool.name)).toContain("jev.evaluate_batch");
    expect(server.stderr()).toContain(`Listening on http://127.0.0.1:${port}/mcp`);
    expect(server.stderr()).not.toContain(token);
  });

  it.skipIf(!hasApiKey)(
    "MCP client -> Streamable HTTP -> jev.noul and jev.models -> TypeSafeProvider -> TypeSafe Jev",
    async () => {
      const port = await freePort();
      const token = randomBytes(32).toString("hex");
      await startServer(serverEnv({ PORT: String(port), JEV_HTTP_TOKEN: token }));
      const mcp = await connect(port, token);

      const result = (await mcp.callTool({
        name: "jev.noul",
        arguments: {
          state: "Help! My payouts have been failing for 3 days.",
          instructions: "Does this message convey urgency?",
        },
      })) as CallToolResult;

      expect(result.isError).toBeFalsy();
      const content = result.structuredContent as { answer: { type: string; noul: number } };
      expect(content.answer.type).toBe("noul");
      expect(content.answer.noul).toBeGreaterThan(0.5);

      const models = (await mcp.callTool({ name: "jev.models", arguments: {} })) as CallToolResult;
      expect(models.isError).toBeFalsy();
    },
  );
});
