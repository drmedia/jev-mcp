import { loadConfig, type ProviderConfig } from "../../src/config/config.js";
import { LocalProvider } from "../../src/providers/local/local-provider.js";
import { OpenRouterProvider } from "../../src/providers/openrouter/openrouter-provider.js";
import { TypeSafeProvider } from "../../src/providers/typesafe/typesafe-provider.js";

// Contract tests target one provider each, regardless of JEV_PROVIDER in .env.

export const hasTypeSafeKey = Boolean(process.env.TYPESAFE_API_KEY?.trim());
export const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());

function providerConfig<Name extends ProviderConfig["name"]>(
  name: Name,
): Extract<ProviderConfig, { name: Name }> {
  const { provider } = loadConfig({ ...process.env, JEV_PROVIDER: name });
  if (provider.name !== name) throw new Error(`expected ${name} config`);
  return provider as Extract<ProviderConfig, { name: Name }>;
}

export function typesafeProviderFromEnv(): TypeSafeProvider {
  const { apiKey, baseUrl } = providerConfig("typesafe");
  return new TypeSafeProvider({ apiKey, baseUrl });
}

export function openRouterProviderFromEnv(): OpenRouterProvider {
  const { apiKey, baseUrl } = providerConfig("openrouter");
  return new OpenRouterProvider({ apiKey, baseUrl });
}

export function localBaseUrlFromEnv(): string {
  return providerConfig("local").baseUrl;
}

export function localProviderFromEnv(): LocalProvider {
  const { apiKey, baseUrl } = providerConfig("local");
  return new LocalProvider({ apiKey, baseUrl });
}

/** True when a local System One server answers its health check (llama-server `/health`). */
export async function isLocalServerUp(): Promise<boolean> {
  try {
    const response = await fetch(`${localBaseUrlFromEnv()}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}
