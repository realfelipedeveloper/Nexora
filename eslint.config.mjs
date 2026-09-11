import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "**/dist/**",
      ".next/**",
      "**/.next/**",
      "coverage/**",
      "**/coverage/**",
      ".nx/**",
      "nexora-sdd-engineering-loop/**",
      "docs/**",
      "**/docs/**",
      "sdd/**",
      "**/sdd/**",
      "agents/**",
      "**/agents/**",
      "skills/**",
      "**/skills/**",
      "adr/**",
      "**/adr/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-extraneous-class": [
        "error",
        {
          allowWithDecorator: true,
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
);
