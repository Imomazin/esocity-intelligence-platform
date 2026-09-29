import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { createdAt, id, timestampTz } from "./columns";
import { dataDomain, ingestionStatus, ingestionTrigger } from "./enums";

/**
 * One row per data ingestion run (scheduled or manual). The partial unique index allows at most
 * one RUNNING row per domain, which doubles as a lease: a second concurrent run fails to insert
 * and backs off. Runs that never finish are marked `abandoned` by the next run.
 */
export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: id(),
    domain: dataDomain("domain").notNull(),
    provider: varchar("provider", { length: 40 }).notNull(),
    trigger: ingestionTrigger("trigger").notNull(),
    status: ingestionStatus("status").notNull().default("running"),
    startedAt: timestampTz("started_at").notNull(),
    finishedAt: timestampTz("finished_at"),
    requestCount: integer("request_count").notNull().default(0),
    rowsWritten: integer("rows_written").notNull().default(0),
    /** Per-item outcomes (symbol or competition): status, rows written, coverage, warnings. */
    items: jsonb("items").$type<Record<string, unknown>[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("ingestion_runs_domain_started_idx").on(t.domain, t.startedAt),
    uniqueIndex("ingestion_runs_one_running_per_domain")
      .on(t.domain)
      .where(sql`${t.status} = 'running'`),
    check(
      "ingestion_runs_finish_after_start",
      sql`${t.finishedAt} is null or ${t.finishedAt} >= ${t.startedAt}`,
    ),
    check(
      "ingestion_runs_finished_unless_running",
      sql`${t.status} = 'running' or ${t.finishedAt} is not null`,
    ),
    check(
      "ingestion_runs_counts_non_negative",
      sql`${t.requestCount} >= 0 and ${t.rowsWritten} >= 0`,
    ),
  ],
);
