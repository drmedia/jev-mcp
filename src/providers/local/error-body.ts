import type { ParsedErrorBody } from "../http/http-errors.js";

const MAX_TEXT_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * llama-server returns errors "in the same format as OAI":
 * `{ "error": { "code": 401, "message": "Invalid API Key", "type": "authentication_error" } }`
 * (tools/server/README.md, "API errors"). `type` becomes the provider code, so
 * `authentication_error` maps to `authentication`.
 */
export function parseLocalErrorBody(text: string): ParsedErrorBody {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { message: undefined, providerCode: undefined, details: text.slice(0, MAX_TEXT_LENGTH) || undefined };
  }
  const error = isRecord(body) ? body.error : undefined;
  if (!isRecord(error)) return { message: undefined, providerCode: undefined, details: body };

  const message = typeof error.message === "string" ? error.message.slice(0, MAX_TEXT_LENGTH) : undefined;
  const type = typeof error.type === "string" ? error.type : undefined;
  return { message, providerCode: type, details: { error } };
}
