import { z } from "zod";
import { JevError } from "../core/errors.js";

export const DEFAULT_TYPESAFE_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_JEV_MODEL = "jev-latest";

export interface JevConfig {
  typesafeApiKey: string;
  typesafeBaseUrl: string;
  jevModel: string;
}

// Empty strings (e.g. `TYPESAFE_BASE_URL=` copied from .env.example) count as unset.
const optionalString = z
  .string()
  .transform((value) => value.trim())
  .optional()
  .transform((value) => (value === undefined || value === "" ? undefined : value));

const envSchema = z.object({
  TYPESAFE_API_KEY: optionalString.pipe(
    z.string({ error: "TYPESAFE_API_KEY is required" }),
  ),
  TYPESAFE_BASE_URL: optionalString
    .pipe(
      z
        .url({ protocol: /^https?$/, error: "TYPESAFE_BASE_URL must be an http(s) URL" })
        .optional(),
    )
    .transform((value) => (value ?? DEFAULT_TYPESAFE_BASE_URL).replace(/\/+$/, "")),
  JEV_MODEL: optionalString.transform((value) => value ?? DEFAULT_JEV_MODEL),
});

/** Single place where environment variables are read and validated. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): JevConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Messages name the variable only; values are never echoed back.
    const problems = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new JevError("configuration", `Invalid configuration: ${problems}`);
  }
  return {
    typesafeApiKey: parsed.data.TYPESAFE_API_KEY,
    typesafeBaseUrl: parsed.data.TYPESAFE_BASE_URL,
    jevModel: parsed.data.JEV_MODEL,
  };
}
