import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";
import { ConfigurationError } from "@/lib/api/errors";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { summarizeInfrastructureError } from "@/lib/security/safe-error";

/**
 * Lazily-initialised PostgreSQL connection (postgres.js + Drizzle).
 *
 * - Nothing connects at import time, so `next build` never needs a database.
 * - `prepare: false` keeps us compatible with transaction-mode poolers (Neon, Supabase,
 *   PgBouncer) that are common on Vercel.
 * - The pool is small: serverless instances are many and short-lived.
 */

export type Database = PostgresJsDatabase<typeof schema>;

interface DatabaseHandle {
  db: Database;
  client: postgres.Sql;
}

const globalForDb = globalThis as unknown as { __esocityDb?: DatabaseHandle };

function createHandle(url: string): DatabaseHandle {
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => undefined,
  });
  return { client, db: drizzle(client, { schema }) };
}

export function getDb(): Database {
  const url = getServerEnv().DATABASE_URL;
  if (!url) {
    throw new ConfigurationError("DATABASE_URL is not configured.");
  }
  globalForDb.__esocityDb ??= createHandle(url);
  return globalForDb.__esocityDb.db;
}

export interface DatabaseHealth {
  status: "up" | "down" | "not_configured";
  latencyMs?: number;
  error?: string;
}

/** Connectivity probe for /api/health. Returns a safe, non-sensitive error summary. */
export async function checkDatabaseHealth(timeoutMs = 2_000): Promise<DatabaseHealth> {
  if (!getServerEnv().DATABASE_URL) return { status: "not_configured" };
  const started = performance.now();
  try {
    getDb();
    const client = globalForDb.__esocityDb?.client;
    if (!client) return { status: "down", error: "Client not initialised" };
    await Promise.race([
      client`select 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    return { status: "up", latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    // Full driver detail goes to the server log only; the summary is safe for public output.
    logger.warn("database.health_check_failed", { error });
    return {
      status: "down",
      latencyMs: Math.round(performance.now() - started),
      error: summarizeInfrastructureError(error),
    };
  }
}

/** Close the pool (scripts and tests). */
export async function closeDb(): Promise<void> {
  const handle = globalForDb.__esocityDb;
  globalForDb.__esocityDb = undefined;
  await handle?.client.end({ timeout: 5 });
}
