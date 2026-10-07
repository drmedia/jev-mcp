import type { ProviderConfig } from "../config/config.js";
import type { JevProvider } from "../core/provider.js";
import { LocalProvider } from "./local/local-provider.js";
import { OpenRouterProvider } from "./openrouter/openrouter-provider.js";
import { TypeSafeProvider } from "./typesafe/typesafe-provider.js";

export interface CreateProviderOptions {
  /** Time limit for each HTTP request; the provider's default applies when omitted. */
  timeoutMs?: number;
}

/** Builds the provider selected by configuration. Used by entry points only. */
export function createProvider(config: ProviderConfig, options: CreateProviderOptions = {}): JevProvider {
  const { apiKey, baseUrl } = config;
  const timeout = options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {};
  switch (config.name) {
    case "typesafe":
      return new TypeSafeProvider({ apiKey: config.apiKey, baseUrl, ...timeout });
    case "openrouter":
      return new OpenRouterProvider({ apiKey: config.apiKey, baseUrl, ...timeout });
    case "local":
      return new LocalProvider({ apiKey, baseUrl, ...timeout });
  }
}
