#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../config/config.js";
import { JevCore } from "../core/jev-core.js";
import { createDirectoryImageLoader } from "../images/directory-image-loader.js";
import { createJevMcpServer } from "../mcp/server.js";
import { createLogger } from "../observability/logger.js";
import { createProvider } from "../providers/create-provider.js";
import { RetryingJevProvider } from "../providers/retrying-provider.js";

// Optional local credentials next to package.json. Variables already set by the
// MCP client or shell take precedence over values in the file.
const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const provider = new RetryingJevProvider(
    createProvider(config.provider, { timeoutMs: config.timeoutMs }),
    {
      policy: { maxRetries: config.jevMaxRetries },
      onRetry: ({ operation, retry, delayMs, error }) =>
        logger.warn(
          `Retrying ${operation} (${retry}/${config.jevMaxRetries}) in ${delayMs} ms after ${error.kind}: ${error.message}`,
        ),
    },
  );
  const loadImageFile =
    config.imageDirectories.length > 0
      ? await createDirectoryImageLoader(config.imageDirectories)
      : undefined;
  const core = new JevCore({
    provider,
    defaultModel: config.jevModel,
    maxInputChars: config.maxInputChars,
    maxConcurrency: config.maxConcurrency,
    logger,
    ...(loadImageFile !== undefined && { loadImageFile }),
  });
  const server = createJevMcpServer(core, { logger });
  await server.connect(new StdioServerTransport());
  // Settings only; never keys or base URLs, which may carry credentials.
  logger.info(
    `Started: provider=${config.provider.name} model=${config.jevModel} timeout=${config.timeoutMs} ms retries=${config.jevMaxRetries} concurrency=${config.maxConcurrency} imageDirs=${config.imageDirectories.length}`,
  );
}

main().catch((error: unknown) => {
  // The configured level is unknown when configuration itself failed.
  createLogger().error("Failed to start the stdio server", error);
  process.exit(1);
});
