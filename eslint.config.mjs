import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * ESLint flat config.
 *
 * ESLint is pinned to v9: eslint-config-next 16 bundles eslint-plugin-react 7.x, which crashes
 * under ESLint 10 (removed `context.getFilename`). Revisit when the Next.js plugin chain
 * supports ESLint 10 — see docs/ARCHITECTURE.md ("Toolchain decisions").
 */
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // App Router project — there is no /pages directory to validate links against.
      "@next/next/no-html-link-for-pages": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-console": ["error", { allow: ["info", "warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
    },
  },
  {
    files: ["db/seed.ts", "db/migrate.ts", "scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Tests assert against untyped JSON response bodies.
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "node_modules/**",
    "services/**",
    "db/migrations/**",
    "next-env.d.ts",
  ]),
]);
