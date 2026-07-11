import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    name: "jsdom",
    environment: "jsdom",
    include: ["src/**/*.dom.test.ts", "src/**/*.dom.test.tsx"],
    setupFiles: ["./src/test/setup.ts", "./src/test/setup-dom.ts"],
  },
});
