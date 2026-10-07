#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../config/config.js";
import { JevCore } from "../core/jev-core.js";
import { createJevMcpServer } from "../mcp/server.js";
import { logError, logWarning } from "../observability/logger.js";
import { createProvider } from "../providers/create-provider.js";
import { RetryingJevProvider } from "../providers/retrying-provider.js";

// Optional local credentials next to package.json. Variables already set by the
// MCP client or shell take precedence over values in the file.
const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  const config = loadConfig();
  const provider = new RetryingJevProvider(
    createProvider(config.provider),
    {
      policy: { maxRetries: config.jevMaxRetries },
      onRetry: ({ operation, retry, delayMs, error }) =>
        logWarning(
          `Retrying ${operation} (${retry}/${config.jevMaxRetries}) in ${delayMs} ms after ${error.kind}: ${error.message}`,
        ),
    },
  );
  const core = new JevCore({ provider, defaultModel: config.jevModel });
  const server = createJevMcpServer(core);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  logError("Failed to start the stdio server", error);
  process.exit(1);
});
