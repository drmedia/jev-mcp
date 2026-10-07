import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { JevConfig } from "../config/config.js";
import { JevCore } from "../core/jev-core.js";
import { createDirectoryImageLoader } from "../images/directory-image-loader.js";
import type { Logger } from "../observability/logger.js";
import { createProvider } from "../providers/create-provider.js";
import { RetryingJevProvider } from "../providers/retrying-provider.js";

/**
 * Loads optional local credentials from `.env` next to package.json. Variables
 * already set by the MCP client or shell take precedence over values in the file.
 */
export function loadLocalEnvFile(): void {
  // Same relative path from src/transport and dist/transport.
  const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

/** Builds the JEV Core that every transport entry point serves. */
export async function createJevCoreFromConfig(config: JevConfig, logger: Logger): Promise<JevCore> {
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
  return new JevCore({
    provider,
    defaultModel: config.jevModel,
    maxInputChars: config.maxInputChars,
    maxConcurrency: config.maxConcurrency,
    logger,
    ...(loadImageFile !== undefined && { loadImageFile }),
  });
}

/** Settings only; never keys or base URLs, which may carry credentials. */
export function describeSettings(config: JevConfig): string {
  return `provider=${config.provider.name} model=${config.jevModel} timeout=${config.timeoutMs} ms retries=${config.jevMaxRetries} concurrency=${config.maxConcurrency} imageDirs=${config.imageDirectories.length}`;
}
