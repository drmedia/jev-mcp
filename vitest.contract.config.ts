import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Local credentials for contract runs. Variables already set in the environment win.
if (existsSync(".env")) process.loadEnvFile(".env");

// Real TypeSafe API tests. Run explicitly with `npm run test:contract`; never part of `npm test`.
export default defineConfig({
  test: {
    include: ["tests/contract/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
