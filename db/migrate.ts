/**
 * Apply SQL migrations from db/migrations.
 *
 *   pnpm db:migrate
 *
 * Uses the same journal table as `drizzle-kit migrate`, so either tool can be used. Run this
 * from CI/CD or a release step — never implicitly during `next build`.
 */
import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("✖ DATABASE_URL is not set. Copy .env.example to .env and configure it.");
    process.exit(1);
  }

  const client = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
  const started = Date.now();
  try {
    await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
    console.log(`✔ Migrations applied in ${Date.now() - started}ms`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error("✖ Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
