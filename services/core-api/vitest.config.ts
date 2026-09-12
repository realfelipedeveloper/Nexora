import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@nexora/config": fileURLToPath(
        new URL("../../packages/config/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    exclude: ["dist/**"],
    globals: true,
    coverage: {
      exclude: ["src/**/*.spec.ts", "src/cli/provision-admin.ts"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 50,
        functions: 40,
        lines: 50,
        statements: 50,
        "src/modules/identity/**/*.ts": {
          branches: 95,
          functions: 95,
          lines: 95,
          statements: 95,
        },
      },
    },
  },
});
