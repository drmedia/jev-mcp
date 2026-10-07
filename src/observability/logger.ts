/**
 * Diagnostics go to stderr. In the stdio server, stdout carries MCP protocol
 * traffic only, so never log through console.log.
 *
 * Never pass secrets (API keys, Authorization headers, .env contents) to a logger.
 */

export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Logger {
  error(message: string, error?: unknown): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

const PREFIX = "[jev-mcp]";

/** Writes messages at `level` and more severe levels; `warn` is the default. */
export function createLogger(
  level: LogLevel = "warn",
  write: (line: string) => void = (line) => process.stderr.write(line),
): Logger {
  const enabled = (messageLevel: LogLevel) => LOG_LEVELS.indexOf(messageLevel) <= LOG_LEVELS.indexOf(level);
  const emit = (messageLevel: LogLevel, message: string) => {
    if (enabled(messageLevel)) write(`${PREFIX} ${messageLevel}: ${message}\n`);
  };
  return {
    error(message, error) {
      const detail = error instanceof Error ? `: ${error.stack ?? error.message}` : "";
      emit("error", `${message}${detail}`);
    },
    warn: (message) => emit("warn", message),
    info: (message) => emit("info", message),
    debug: (message) => emit("debug", message),
  };
}

/** Discards everything; the default where no logger is injected. */
export const silentLogger: Logger = {
  error() {},
  warn() {},
  info() {},
  debug() {},
};

const MAX_EXCERPT_LENGTH = 2000;

/** A bounded JSON rendering of diagnostic data, for logs only. */
export function excerpt(value: unknown, maxLength = MAX_EXCERPT_LENGTH): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  } catch {
    text = String(value);
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}... (${text.length - maxLength} more characters)` : text;
}
