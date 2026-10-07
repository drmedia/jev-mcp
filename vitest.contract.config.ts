import { defineConfig } from "vitest/config";

// Real TypeSafe API tests. Run explicitly with `npm run test:contract`; never part of `npm test`.
export default defineConfig({
  test: {
    include: ["tests/contract/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
