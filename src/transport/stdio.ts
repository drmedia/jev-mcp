#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../config/config.js";
import { createJevMcpServer } from "../mcp/server.js";
import { createLogger } from "../observability/logger.js";
import { createJevCoreFromConfig, describeSettings, loadLocalEnvFile } from "./runtime.js";

loadLocalEnvFile();

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const core = await createJevCoreFromConfig(config, logger);
  const server = createJevMcpServer(core, { logger });
  await server.connect(new StdioServerTransport());
  logger.info(`Started: ${describeSettings(config)}`);
}

main().catch((error: unknown) => {
  // The configured level is unknown when configuration itself failed.
  createLogger().error("Failed to start the stdio server", error);
  process.exit(1);
});
