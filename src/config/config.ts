import { z } from "zod";
import { JevError } from "../core/errors.js";

export const DEFAULT_TYPESAFE_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api";
export const DEFAULT_JEV_MODEL = "jev-latest";
export const DEFAULT_JEV_MAX_RETRIES = 2;
export const MAX_JEV_MAX_RETRIES = 10;
export const PROVIDER_NAMES = ["typesafe", "openrouter"] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

export type ProviderConfig =
  | { name: "typesafe"; apiKey: string; baseUrl: string }
  | { name: "openrouter"; apiKey: string; baseUrl: string };

export interface JevConfig {
  provider: ProviderConfig;
  /** Model used when an evaluate input names none; the format depends on the provider. */
  jevModel: string;
  /** Retries after the first attempt for transient failures; 0 disables retries. */
  jevMaxRetries: number;
}

// Empty strings (e.g. `TYPESAFE_BASE_URL=` copied from .env.example) count as unset.
const optionalString = z
  .string()
  .transform((value) => value.trim())
  .optional()
  .transform((value) => (value === undefined || value === "" ? undefined : value));

function baseUrl(variable: string, fallback: string) {
  return optionalString
    .pipe(
      z.url({ protocol: /^https?$/, error: `${variable} must be an http(s) URL` }).optional(),
    )
    .transform((value) => (value ?? fallback).replace(/\/+$/, ""));
}

const maxRetriesMessage = `JEV_MAX_RETRIES must be a whole number from 0 to ${MAX_JEV_MAX_RETRIES}`;

const envSchema = z.object({
  JEV_PROVIDER: optionalString.pipe(
    z
      .enum(PROVIDER_NAMES, { error: `JEV_PROVIDER must be one of: ${PROVIDER_NAMES.join(", ")}` })
      .optional()
      .transform((value) => value ?? "typesafe"),
  ),
  TYPESAFE_API_KEY: optionalString,
  TYPESAFE_BASE_URL: baseUrl("TYPESAFE_BASE_URL", DEFAULT_TYPESAFE_BASE_URL),
  OPENROUTER_API_KEY: optionalString,
  OPENROUTER_BASE_URL: baseUrl("OPENROUTER_BASE_URL", DEFAULT_OPENROUTER_BASE_URL).refine(
    // Paths are appended as /v1/...; a base ending in /v1 would produce /v1/v1/....
    (value) => !/\/v1$/.test(value),
    "OPENROUTER_BASE_URL must be the API root without /v1 (for example https://openrouter.ai/api)",
  ),
  JEV_MODEL: optionalString.transform((value) => value ?? DEFAULT_JEV_MODEL),
  JEV_MAX_RETRIES: optionalString.pipe(
    z
      .string()
      .regex(/^\d+$/, maxRetriesMessage)
      .transform(Number)
      .pipe(z.number().max(MAX_JEV_MAX_RETRIES, maxRetriesMessage))
      .optional()
      .transform((value) => value ?? DEFAULT_JEV_MAX_RETRIES),
  ),
});

function invalid(problems: string): never {
  throw new JevError("configuration", `Invalid configuration: ${problems}`);
}

/** Single place where environment variables are read and validated. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): JevConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Messages name the variable only; values are never echoed back.
    invalid(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  const data = parsed.data;

  // The selected provider's key is required; another provider's key is never used
  // as a fallback.
  let provider: ProviderConfig;
  switch (data.JEV_PROVIDER) {
    case "typesafe":
      if (data.TYPESAFE_API_KEY === undefined) invalid("TYPESAFE_API_KEY is required");
      provider = { name: "typesafe", apiKey: data.TYPESAFE_API_KEY, baseUrl: data.TYPESAFE_BASE_URL };
      break;
    case "openrouter":
      if (data.OPENROUTER_API_KEY === undefined) {
        invalid("OPENROUTER_API_KEY is required when JEV_PROVIDER=openrouter");
      }
      provider = { name: "openrouter", apiKey: data.OPENROUTER_API_KEY, baseUrl: data.OPENROUTER_BASE_URL };
      break;
  }

  return { provider, jevModel: data.JEV_MODEL, jevMaxRetries: data.JEV_MAX_RETRIES };
}
