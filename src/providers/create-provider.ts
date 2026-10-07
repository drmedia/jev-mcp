import type { ProviderConfig } from "../config/config.js";
import type { JevProvider } from "../core/provider.js";
import { LocalProvider } from "./local/local-provider.js";
import { OpenRouterProvider } from "./openrouter/openrouter-provider.js";
import { TypeSafeProvider } from "./typesafe/typesafe-provider.js";

/** Builds the provider selected by configuration. Used by entry points only. */
export function createProvider(config: ProviderConfig): JevProvider {
  switch (config.name) {
    case "typesafe":
      return new TypeSafeProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    case "openrouter":
      return new OpenRouterProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    case "local":
      return new LocalProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  }
}
