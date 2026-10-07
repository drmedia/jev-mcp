import { delimiter, isAbsolute } from "node:path";
import { z } from "zod";
import { JevError } from "../core/errors.js";
import { LOG_LEVELS, type LogLevel } from "../observability/logger.js";

export const DEFAULT_TYPESAFE_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api";
/** The port used in docs/local-provider.md; 8080, llama-server's own default, is often taken. */
export const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8097";
export const DEFAULT_JEV_MODEL = "jev-latest";
export const DEFAULT_JEV_MAX_RETRIES = 2;
export const MAX_JEV_MAX_RETRIES = 10;
export const DEFAULT_JEV_TIMEOUT_MS = 30_000;
export const MIN_JEV_TIMEOUT_MS = 1_000;
export const MAX_JEV_TIMEOUT_MS = 600_000;
export const DEFAULT_JEV_LOG_LEVEL: LogLevel = "warn";
export const DEFAULT_JEV_MAX_CONCURRENCY = 4;
export const MAX_JEV_MAX_CONCURRENCY = 16;
/**
 * About 64k tokens of English text at roughly 4 characters per token, the largest
 * documented context among supported models (Jev 64k, Clef 65,536). Text in scripts
 * such as Korean uses more tokens per character, so the same limit allows more tokens.
 */
export const DEFAULT_JEV_MAX_INPUT_CHARS = 256_000;
export const PROVIDER_NAMES = ["typesafe", "openrouter", "local"] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

export type ProviderConfig =
  | { name: "typesafe"; apiKey: string; baseUrl: string }
  | { name: "openrouter"; apiKey: string; baseUrl: string }
  /** A System One-compatible server the user runs; the key is optional. */
  | { name: "local"; apiKey: string | undefined; baseUrl: string };

export interface JevConfig {
  provider: ProviderConfig;
  /** Model used when an evaluate input names none; the format depends on the provider. */
  jevModel: string;
  /** Retries after the first attempt for transient failures; 0 disables retries. */
  jevMaxRetries: number;
  /** Absolute directories `images[].path` may read from; empty disables image paths. */
  imageDirectories: string[];
  /** Maximum characters of text input (`state` plus `questions`) per request; 0 disables the check. */
  maxInputChars: number;
  /** Maximum provider requests a batch runs at the same time. */
  maxConcurrency: number;
  /** Time limit for each provider HTTP request, per attempt. */
  timeoutMs: number;
  /** Least severe level written to stderr. */
  logLevel: LogLevel;
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

const timeoutMessage = `JEV_TIMEOUT_MS must be a whole number of milliseconds from ${MIN_JEV_TIMEOUT_MS} to ${MAX_JEV_TIMEOUT_MS}`;
const maxConcurrencyMessage =`JEV_MAX_CONCURRENCY must be a whole number from 1 to ${MAX_JEV_MAX_CONCURRENCY}`;
const maxRetriesMessage =`JEV_MAX_RETRIES must be a whole number from 0 to ${MAX_JEV_MAX_RETRIES}`;

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
  JEV_LOCAL_BASE_URL: baseUrl("JEV_LOCAL_BASE_URL", DEFAULT_LOCAL_BASE_URL).refine(
    (value) => !/\/v1$/.test(value),
    "JEV_LOCAL_BASE_URL must be the server root without /v1 (for example http://127.0.0.1:8097)",
  ),
  JEV_LOCAL_API_KEY: optionalString,
  JEV_MODEL: optionalString.transform((value) => value ?? DEFAULT_JEV_MODEL),
  // Separated by the platform path delimiter: ";" on Windows, ":" elsewhere.
  JEV_IMAGE_DIRS: optionalString
    .transform((value) =>
      value === undefined
        ? []
        : value
            .split(delimiter)
            .map((entry) => entry.trim())
            .filter((entry) => entry !== ""),
    )
    .refine(
      (entries) => entries.every((entry) => isAbsolute(entry)),
      `JEV_IMAGE_DIRS entries must be absolute paths separated by "${delimiter}"`,
    ),
  JEV_MAX_INPUT_CHARS: optionalString.pipe(
    z
      .string()
      .regex(/^\d+$/, "JEV_MAX_INPUT_CHARS must be a whole number (0 disables the limit)")
      .transform(Number)
      .optional()
      .transform((value) => value ?? DEFAULT_JEV_MAX_INPUT_CHARS),
  ),
  JEV_TIMEOUT_MS: optionalString.pipe(
    z
      .string()
      .regex(/^\d+$/, timeoutMessage)
      .transform(Number)
      .pipe(z.number().min(MIN_JEV_TIMEOUT_MS, timeoutMessage).max(MAX_JEV_TIMEOUT_MS, timeoutMessage))
      .optional()
      .transform((value) => value ?? DEFAULT_JEV_TIMEOUT_MS),
  ),
  JEV_LOG_LEVEL: optionalString.pipe(
    z
      .enum(LOG_LEVELS, { error: `JEV_LOG_LEVEL must be one of: ${LOG_LEVELS.join(", ")}` })
      .optional()
      .transform((value) => value ?? DEFAULT_JEV_LOG_LEVEL),
  ),
  JEV_MAX_CONCURRENCY: optionalString.pipe(
    z
      .string()
      .regex(/^\d+$/, maxConcurrencyMessage)
      .transform(Number)
      .pipe(z.number().min(1, maxConcurrencyMessage).max(MAX_JEV_MAX_CONCURRENCY, maxConcurrencyMessage))
      .optional()
      .transform((value) => value ?? DEFAULT_JEV_MAX_CONCURRENCY),
  ),
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
    case "local":
      provider = { name: "local", apiKey: data.JEV_LOCAL_API_KEY, baseUrl: data.JEV_LOCAL_BASE_URL };
      break;
  }

  return {
    provider,
    jevModel: data.JEV_MODEL,
    jevMaxRetries: data.JEV_MAX_RETRIES,
    imageDirectories: data.JEV_IMAGE_DIRS,
    maxInputChars: data.JEV_MAX_INPUT_CHARS,
    maxConcurrency: data.JEV_MAX_CONCURRENCY,
    timeoutMs: data.JEV_TIMEOUT_MS,
    logLevel: data.JEV_LOG_LEVEL,
  };
}

export const DEFAULT_HTTP_PORT = 8098;
/**
 * Addresses the HTTP server may listen on. `0.0.0.0` is for containers only, where the
 * port is published on the host's loopback address; remote access is out of scope.
 */
export const HTTP_HOSTS = ["127.0.0.1", "0.0.0.0"] as const;
export type HttpHost = (typeof HTTP_HOSTS)[number];
/** A token shorter than this is rejected; generate one with crypto.randomBytes(32). */
export const MIN_HTTP_TOKEN_LENGTH = 32;

/** Settings that only the Streamable HTTP entry point needs. */
export interface HttpConfig {
  /** Listen address; `127.0.0.1` unless running in a container. */
  host: HttpHost;
  port: number;
  /** Shared secret every request must send as `Authorization: Bearer <token>`. */
  token: string;
}

const portMessage = "PORT must be a whole number from 1 to 65535";

const httpEnvSchema = z.object({
  PORT: optionalString.pipe(
    z
      .string()
      .regex(/^\d+$/, portMessage)
      .transform(Number)
      .pipe(z.number().min(1, portMessage).max(65_535, portMessage))
      .optional()
      .transform((value) => value ?? DEFAULT_HTTP_PORT),
  ),
  JEV_HTTP_TOKEN: optionalString,
  JEV_HTTP_HOST: optionalString.pipe(
    z
      .enum(HTTP_HOSTS, {
        error: `JEV_HTTP_HOST must be one of: ${HTTP_HOSTS.join(", ")} (0.0.0.0 only inside a container)`,
      })
      .optional()
      .transform((value) => value ?? "127.0.0.1"),
  ),
});

/** Reads the HTTP entry point's settings. Messages name variables only, never values. */
export function loadHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const parsed = httpEnvSchema.safeParse(env);
  if (!parsed.success) invalid(parsed.error.issues.map((issue) => issue.message).join("; "));
  const { PORT: port, JEV_HTTP_TOKEN: token, JEV_HTTP_HOST: host } = parsed.data;
  if (token === undefined) invalid("JEV_HTTP_TOKEN is required for the HTTP server");
  if (token.length < MIN_HTTP_TOKEN_LENGTH) {
    invalid(`JEV_HTTP_TOKEN must be at least ${MIN_HTTP_TOKEN_LENGTH} characters`);
  }
  return { host, port, token };
}
