/**
 * Diagnostics go to stderr. In the stdio server, stdout carries MCP protocol
 * traffic only, so never log through console.log.
 */
export function logError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? `: ${error.stack ?? error.message}` : "";
  process.stderr.write(`[jev-mcp] ${message}${detail}\n`);
}
