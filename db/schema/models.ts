import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createdAt, id, timestampTz, updatedAt } from "./columns";
import { modelDomain, modelRunType, modelStatus, runStatus } from "./enums";

export const modelVersions = pgTable(
  "model_versions",
  {
    id: id(),
    /** Stable model identifier, e.g. "markets.composite-signal". */
    modelKey: varchar("model_key", { length: 80 }).notNull(),
    version: varchar("version", { length: 32 }).notNull(),
    domain: modelDomain("domain").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    status: modelStatus("status").notNull().default("development"),
    description: text("description").notNull(),
    trainingData: text("training_data").notNull(),
    featureGroups: jsonb("feature_groups").$type<string[]>().notNull().default([]),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
    releasedAt: timestampTz("released_at"),
    lastEvaluatedAt: timestampTz("last_evaluated_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("model_versions_key_version_unique").on(t.modelKey, t.version),
    index("model_versions_domain_status_idx").on(t.domain, t.status),
  ],
);

export const modelRuns = pgTable(
  "model_runs",
  {
    id: id(),
    modelVersionId: uuid("model_version_id")
      .notNull()
      .references(() => modelVersions.id, { onDelete: "cascade" }),
    runType: modelRunType("run_type").notNull(),
    status: runStatus("status").notNull(),
    startedAt: timestampTz("started_at").notNull(),
    finishedAt: timestampTz("finished_at"),
    parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull().default({}),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("model_runs_version_started_idx").on(t.modelVersionId, t.startedAt),
    check(
      "model_runs_finish_after_start",
      sql`${t.finishedAt} is null or ${t.finishedAt} >= ${t.startedAt}`,
    ),
  ],
);
