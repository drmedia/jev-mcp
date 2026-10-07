#!/usr/bin/env node
import { loadConfig, loadHttpConfig } from "../config/config.js";
import { createLogger } from "../observability/logger.js";
import { createJevHttpServer, HTTP_BIND_ADDRESS, MCP_PATH } from "./http-server.js";
import { createJevCoreFromConfig, describeSettings, loadLocalEnvFile } from "./runtime.js";

loadLocalEnvFile();

async function main(): Promise<void> {
  const config = loadConfig();
  const { host, port, token } = loadHttpConfig();
  const logger = createLogger(config.logLevel);
  const core = await createJevCoreFromConfig(config, logger);
  const server = createJevHttpServer({ core, token, logger });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  // Always shown: an HTTP server that runs silently is hard to find. The token is never printed.
  // With host 0.0.0.0 (containers), clients still connect through the host's loopback address.
  const scope = host === HTTP_BIND_ADDRESS ? "" : " (all container interfaces)";
  process.stderr.write(`[jev-mcp] Listening on http://${HTTP_BIND_ADDRESS}:${port}${MCP_PATH}${scope}\n`);
  logger.info(`Started: ${describeSettings(config)}`);

  const shutdown = () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  // The configured level is unknown when configuration itself failed.
  createLogger().error("Failed to start the HTTP server", error);
  process.exit(1);
});
