import { and, desc, eq, lt } from "drizzle-orm";

import type { Database } from "@/db/client";
import { ingestionRuns } from "@/db/schema";
import type {
  DataDomain,
  IngestionItem,
  IngestionRunRecord,
  IngestionRunStore,
} from "@/lib/ingestion/types";

const UNIQUE_VIOLATION = "23505";

function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * PostgreSQL ingestion-run log. `start` inserts a RUNNING row; the partial unique index on
 * (domain) WHERE status = 'running' turns that insert into an atomic lease, so overlapping cron
 * invocations or a manual run during a scheduled one cannot write concurrently.
 */
export class PostgresIngestionRunStore implements IngestionRunStore {
  constructor(private readonly db: Database) {}

  async start(input: {
    domain: DataDomain;
    provider: string;
    trigger: "schedule" | "manual";
    startedAt: Date;
    staleAfterMs: number;
  }): Promise<{ id: string } | null> {
    const staleBefore = new Date(input.startedAt.getTime() - input.staleAfterMs);
    await this.db
      .update(ingestionRuns)
      .set({
        status: "abandoned",
        finishedAt: input.startedAt,
        error: "The run did not report completion (timed out or the process stopped).",
      })
      .where(
        and(
          eq(ingestionRuns.domain, input.domain),
          eq(ingestionRuns.status, "running"),
          lt(ingestionRuns.startedAt, staleBefore),
        ),
      );
    try {
      const [row] = await this.db
        .insert(ingestionRuns)
        .values({
          domain: input.domain,
          provider: input.provider,
          trigger: input.trigger,
          status: "running",
          startedAt: input.startedAt,
        })
        .returning({ id: ingestionRuns.id });
      return row ?? null;
    } catch (error) {
      if (sqlState(error) === UNIQUE_VIOLATION) return null;
      throw error;
    }
  }

  async finish(id: string, result: Parameters<IngestionRunStore["finish"]>[1]): Promise<void> {
    await this.db
      .update(ingestionRuns)
      .set({
        status: result.status,
        finishedAt: result.finishedAt,
        requestCount: result.requestCount,
        rowsWritten: result.rowsWritten,
        items: result.items.map((item) => ({ ...item })),
        warnings: result.warnings,
        error: result.error,
      })
      .where(eq(ingestionRuns.id, id));
  }

  async recent(domain: DataDomain, limit: number): Promise<IngestionRunRecord[]> {
    const rows = await this.db
      .select()
      .from(ingestionRuns)
      .where(eq(ingestionRuns.domain, domain))
      .orderBy(desc(ingestionRuns.startedAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      domain: row.domain,
      provider: row.provider,
      trigger: row.trigger,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      requestCount: row.requestCount,
      rowsWritten: row.rowsWritten,
      items: row.items as unknown as IngestionItem[],
      warnings: row.warnings,
      error: row.error,
    }));
  }
}
