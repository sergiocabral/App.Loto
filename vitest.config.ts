import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**"],
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html"],
      thresholds: {
        statements: 31,
        branches: 31,
        functions: 26,
        lines: 31,
      },
    },
    projects: ["./vitest.node.config.ts", "./vitest.jsdom.config.ts", "./vitest.postgres.config.ts"],
  },
});
