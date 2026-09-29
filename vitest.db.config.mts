import { configDefaults, defineConfig } from "vitest/config";

import base from "./vitest.config.mjs";

/**
 * PostgreSQL integration tests (repositories, ingestion lease, stored providers).
 *
 *   TEST_DATABASE_URL=postgresql://… pnpm test:db
 *
 * Point TEST_DATABASE_URL at a migrated, disposable database — never a production one. The tests
 * write rows under dedicated test keys and remove them afterwards. Without TEST_DATABASE_URL the
 * suite is skipped.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/db/**/*.test.ts"],
    exclude: configDefaults.exclude,
    // The ingestion lease is global per domain: run files one at a time.
    fileParallelism: false,
    env: { ...base.test?.env, DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" },
  },
});
