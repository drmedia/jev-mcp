import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { JevError } from "../core/errors.js";
import { logError } from "../observability/logger.js";

export function toolSuccess(result: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

/** Converts a failure into an MCP tool error. Never returns a fabricated answer. */
export function toolError(error: unknown, signal?: AbortSignal): CallToolResult {
  let body: Record<string, unknown>;
  if (error instanceof JevError) {
    body = {
      kind: error.kind,
      message: error.message,
      ...(error.status !== undefined && { status: error.status }),
      ...(error.retryAfterSeconds !== undefined && { retryAfterSeconds: error.retryAfterSeconds }),
    };
  } else if (signal?.aborted) {
    body = { kind: "cancelled", message: "The request was cancelled" };
  } else {
    logError("Unexpected error while handling a tool call", error);
    body = { kind: "internal", message: "Unexpected server error" };
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ error: body }) }],
    isError: true,
  };
}
