import { loadConfig } from "../../src/config/config.js";
import { OpenRouterProvider } from "../../src/providers/openrouter/openrouter-provider.js";
import { TypeSafeProvider } from "../../src/providers/typesafe/typesafe-provider.js";

// Contract tests target one provider each, regardless of JEV_PROVIDER in .env.

export const hasTypeSafeKey = Boolean(process.env.TYPESAFE_API_KEY?.trim());
export const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());

export function typesafeProviderFromEnv(): TypeSafeProvider {
  const { provider } = loadConfig({ ...process.env, JEV_PROVIDER: "typesafe" });
  return new TypeSafeProvider({ apiKey: provider.apiKey, baseUrl: provider.baseUrl });
}

export function openRouterProviderFromEnv(): OpenRouterProvider {
  const { provider } = loadConfig({ ...process.env, JEV_PROVIDER: "openrouter" });
  return new OpenRouterProvider({ apiKey: provider.apiKey, baseUrl: provider.baseUrl });
}
