import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_JEV_MODEL, type JevConfig, type ProviderConfig } from "../config/config.js";
import { JevCore, type JevProviderEntry } from "../core/jev-core.js";
import type { JevProvider } from "../core/provider.js";
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

/**
 * Model used when a request selects a non-default provider without naming one.
 * OpenRouter has none: any default would be a guess, so a model is required there.
 */
function additionalDefaultModel(name: ProviderConfig["name"]): string | undefined {
  return name === "openrouter" ? undefined : DEFAULT_JEV_MODEL;
}

/** Each provider gets its own retry wrapper, so retries never cross providers. */
function withRetries(providerConfig: ProviderConfig, config: JevConfig, logger: Logger): JevProvider {
  return new RetryingJevProvider(createProvider(providerConfig, { timeoutMs: config.timeoutMs }), {
    policy: { maxRetries: config.jevMaxRetries },
    onRetry: ({ operation, retry, delayMs, error }) =>
      logger.warn(
        `Retrying ${providerConfig.name} ${operation} (${retry}/${config.jevMaxRetries}) in ${delayMs} ms after ${error.kind}: ${error.message}`,
      ),
  });
}

/** Builds the JEV Core that every transport entry point serves. */
export async function createJevCoreFromConfig(config: JevConfig, logger: Logger): Promise<JevCore> {
  const provider = withRetries(config.provider, config, logger);
  const additionalProviders: Record<string, JevProviderEntry> = {};
  for (const extra of config.additionalProviders) {
    const defaultModel = additionalDefaultModel(extra.name);
    additionalProviders[extra.name] = {
      provider: withRetries(extra, config, logger),
      ...(defaultModel !== undefined && { defaultModel }),
    };
  }
  const loadImageFile =
    config.imageDirectories.length > 0
      ? await createDirectoryImageLoader(config.imageDirectories)
      : undefined;
  return new JevCore({
    provider,
    providerName: config.provider.name,
    additionalProviders,
    defaultModel: config.jevModel,
    maxInputChars: config.maxInputChars,
    maxConcurrency: config.maxConcurrency,
    logger,
    ...(loadImageFile !== undefined && { loadImageFile }),
  });
}

/** Settings only; never keys or base URLs, which may carry credentials. */
export function describeSettings(config: JevConfig): string {
  const extra = config.additionalProviders.map((provider) => provider.name);
  return `provider=${config.provider.name}${extra.length > 0 ? ` (also ${extra.join(", ")})` : ""} model=${config.jevModel} timeout=${config.timeoutMs} ms retries=${config.jevMaxRetries} concurrency=${config.maxConcurrency} imageDirs=${config.imageDirectories.length}`;
}
