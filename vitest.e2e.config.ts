import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Local credentials for e2e runs. Variables already set in the environment win.
if (existsSync(".env")) process.loadEnvFile(".env");

// Spawns the built stdio server (dist/) and talks to it over MCP.
// Run with `npm run test:e2e`, which builds first; never part of `npm test`.
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
