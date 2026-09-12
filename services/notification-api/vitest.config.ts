import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["dist/**"],
    globals: true,
    coverage: {
      exclude: ["src/**/*.spec.ts"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 50,
        functions: 40,
        lines: 50,
        statements: 50,
      },
    },
  },
});
