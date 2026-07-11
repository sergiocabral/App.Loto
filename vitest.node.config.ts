import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    name: "node",
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["src/**/*.dom.test.ts", "src/**/*.dom.test.tsx", "src/**/*.postgres.test.ts", "src/**/*.postgres.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
