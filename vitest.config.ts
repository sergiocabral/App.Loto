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
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
        "src/app/api/**/route.ts": {
          branches: 85,
          functions: 90,
          lines: 90,
        },
        "src/lib/analysis.ts": {
          branches: 85,
          functions: 90,
          lines: 90,
        },
        "src/lib/server/security.ts": {
          branches: 85,
          functions: 90,
          lines: 90,
        },
        "src/lib/server/service.ts": {
          branches: 85,
          functions: 90,
          lines: 90,
        },
        "src/lib/server/repository.ts": {
          branches: 70,
          functions: 90,
          lines: 90,
        },
      },
    },
    projects: ["./vitest.node.config.ts", "./vitest.jsdom.config.ts", "./vitest.postgres.config.ts"],
  },
});
