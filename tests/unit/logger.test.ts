import { describe, expect, it, vi } from "vitest";
import { createLogger, excerpt } from "../../src/observability/logger.js";

function capture(level?: Parameters<typeof createLogger>[0]) {
  const lines: string[] = [];
  const logger = createLogger(level, (line) => lines.push(line));
  return { logger, lines };
}

describe("createLogger", () => {
  it("writes warnings and errors by default, with the level in each line", () => {
    const { logger, lines } = capture();

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e", new Error("boom"));

    expect(lines[0]).toBe("[jev-mcp] warn: w\n");
    expect(lines[1]).toMatch(/^\[jev-mcp\] error: e: Error: boom/);
    expect(lines).toHaveLength(2);
  });

  it.each([
    ["error", ["error"]],
    ["warn", ["warn", "error"]],
    ["info", ["info", "warn", "error"]],
    ["debug", ["debug", "info", "warn", "error"]],
  ] as const)("at %s writes %j", (level, expected) => {
    const { logger, lines } = capture(level);

    logger.debug("m");
    logger.info("m");
    logger.warn("m");
    logger.error("m");

    expect(lines.map((line) => line.split(" ")[1]!.replace(":", ""))).toEqual(expected);
  });

  it("writes to stderr, never stdout, when no writer is given", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const stdout = vi.spyOn(process.stdout, "write");
    try {
      createLogger("warn").warn("to stderr");
      expect(stderr).toHaveBeenCalledWith("[jev-mcp] warn: to stderr\n");
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });
});

describe("excerpt", () => {
  it("renders values as JSON and cuts long text", () => {
    expect(excerpt({ a: 1 })).toBe('{"a":1}');
    expect(excerpt("plain")).toBe("plain");
    expect(excerpt(undefined)).toBe("undefined");
    expect(excerpt("x".repeat(30), 10)).toBe(`${"x".repeat(10)}... (20 more characters)`);
  });
});
