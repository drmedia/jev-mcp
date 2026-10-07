import type { ParsedErrorBody } from "../http/http-errors.js";

const MAX_MESSAGE_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text;
}

/**
 * OpenRouter validation errors carry a JSON-encoded list of issues in `message`,
 * e.g. `[{"path":["questions"],"message":"Invalid input: ..."}]`. Flatten them.
 */
function formatMessage(raw: string): string {
  try {
    const issues: unknown = JSON.parse(raw);
    if (Array.isArray(issues)) {
      const lines = issues
        .filter(isRecord)
        .map((issue) => {
          const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
          const message = typeof issue.message === "string" ? issue.message : "";
          return path ? `${path}: ${message}` : message;
        })
        .filter((line) => line.length > 0);
      if (lines.length > 0) return truncate(lines.join("; "));
    }
  } catch {
    // Not JSON: use the message as is.
  }
  return truncate(raw);
}

/**
 * OpenRouter error bodies look like `{ "error": { "message": "...", "code": 400 }, "user_id": "..." }`
 * (https://openrouter.ai/docs/api/api-reference/systemone/submit-a-system-one-request).
 * Only `error.code` and the message are kept: other top-level fields such as
 * `user_id` identify the account and are not exposed.
 */
export function parseOpenRouterErrorBody(text: string): ParsedErrorBody {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { message: undefined, providerCode: undefined, details: truncate(text) || undefined };
  }

  const error = isRecord(body) ? body.error : undefined;
  if (!isRecord(error)) return { message: undefined, providerCode: undefined, details: undefined };

  const message = typeof error.message === "string" ? formatMessage(error.message) : undefined;
  const code = typeof error.code === "number" || typeof error.code === "string" ? error.code : undefined;
  return {
    message,
    providerCode: undefined,
    details: { error: { ...(code !== undefined && { code }), ...(message !== undefined && { message }) } },
  };
}
