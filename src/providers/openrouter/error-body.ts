import type { ParsedErrorBody } from "../http/http-errors.js";

const MAX_MESSAGE_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text;
}

/**
 * Errors relayed from the model's own API arrive as `"HTTP <status>: <json body>"`.
 * Observed bodies: TypeSafe `{ "detail": { "error_type": "max_tokens_exceeded" } }` and
 * Cloudflare `{ "errors": [{ "message": "AiError: ..." }] }`. Returns the useful part.
 */
function upstreamMessage(raw: string): string | undefined {
  const match = /^HTTP \d{3}: (\{.*\})$/s.exec(raw.trim());
  if (!match) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(match[1]!);
  } catch {
    return undefined;
  }
  if (!isRecord(body)) return undefined;
  if (isRecord(body.detail)) {
    const { message, error_type: errorType } = body.detail;
    if (typeof message === "string") return message;
    if (typeof errorType === "string") return errorType;
  }
  if (Array.isArray(body.errors)) {
    const messages = body.errors
      .filter(isRecord)
      .map((error) => error.message)
      .filter((message): message is string => typeof message === "string");
    if (messages.length > 0) return messages.join("; ");
  }
  return undefined;
}

/**
 * OpenRouter validation errors carry a JSON-encoded list of issues in `message`,
 * e.g. `[{"path":["questions"],"message":"Invalid input: ..."}]`. Flatten them.
 */
function formatMessage(raw: string): string {
  const upstream = upstreamMessage(raw);
  if (upstream !== undefined) return truncate(upstream);
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
    // Observed for openai/gpt-6-luna-decisions on 2026-10-07: HTTP 502 with
    // `OpenAI refused to answer question "<id>"`; the whole request fails.
    providerCode: message !== undefined && /\brefused to answer question\b/.test(message) ? "refusal" : undefined,
    details: { error: { ...(code !== undefined && { code }), ...(message !== undefined && { message }) } },
  };
}
