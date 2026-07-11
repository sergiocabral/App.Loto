import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    name: "postgres",
    environment: "node",
    fileParallelism: false,
    globalSetup: ["./src/test/postgres.global-setup.ts"],
    hookTimeout: 60_000,
    include: ["src/**/*.postgres.test.ts", "src/**/*.postgres.test.tsx"],
    setupFiles: ["./src/test/setup.ts", "./src/test/setup-postgres.ts"],
    testTimeout: 60_000,
  },
});
