import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@/": rootDir,
      // `server-only` throws outside the React Server Components bundler condition.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    testTimeout: 20_000,
    env: {
      DEMO_MODE: "true",
      DEMO_AS_OF: "2026-09-25",
      MARKET_DATA_PROVIDER: "demo",
      SPORTS_DATA_PROVIDER: "demo",
    },
  },
});
