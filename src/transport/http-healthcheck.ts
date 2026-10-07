#!/usr/bin/env node
import { loadHttpConfig } from "../config/config.js";
import { MCP_PATH } from "./http-server.js";
import { loadLocalEnvFile } from "./runtime.js";

loadLocalEnvFile();

/**
 * Exits 0 when the local HTTP server answers an authenticated MCP initialize request,
 * 1 otherwise. Used as the container health check; prints nothing secret.
 */
async function main(): Promise<number> {
  const { port, token } = loadHttpConfig();
  const response = await fetch(`http://127.0.0.1:${port}${MCP_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "healthcheck", version: "0" } },
    }),
    signal: AbortSignal.timeout(5000),
  });
  const body = (await response.json()) as { result?: { serverInfo?: { name?: string } } };
  if (response.ok && body.result?.serverInfo?.name === "jev-mcp") return 0;
  process.stderr.write(`[jev-mcp] Health check failed with HTTP ${response.status}\n`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`[jev-mcp] Health check failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
