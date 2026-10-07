import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { JevCore } from "../core/jev-core.js";
import { createLogger, type Logger } from "../observability/logger.js";
import { registerJevTools } from "./tools.js";

// Same relative path from src/mcp and dist/mcp.
const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };

export interface JevMcpServerOptions {
  /** Receives unexpected tool errors. Defaults to warnings and errors on stderr. */
  logger?: Logger;
}

/** Builds the transport-independent MCP server exposing the JEV tools. */
export function createJevMcpServer(core: JevCore, options: JevMcpServerOptions = {}): McpServer {
  const server = new McpServer({ name: "jev-mcp", version });
  registerJevTools(server, core, options.logger ?? createLogger());
  return server;
}
