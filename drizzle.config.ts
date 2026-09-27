import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Load .env / .env.local exactly the way Next.js does.
loadEnvConfig(process.cwd());

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dbCredentials: {
    // Only required for commands that talk to a database (migrate/studio/push).
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
