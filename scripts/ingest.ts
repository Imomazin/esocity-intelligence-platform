/**
 * Run licensed-data ingestion from a terminal: first backfills, catching up after an outage,
 * or verifying a new API key with --dry-run (fetches and validates, writes nothing).
 *
 *   pnpm ingest markets [--dry-run] [--symbols AAPL,MSFT] [--backfill-days 1825]
 *   pnpm ingest sports  [--dry-run] [--leagues 39,140]
 *
 * Uses the same code path as the scheduled job (/api/cron/ingest/:domain), without its time
 * budget. Reads configuration from .env / .env.local like `next dev`.
 */
import { parseArgs } from "node:util";

import { loadEnvConfig } from "@next/env";

import { closeDb } from "@/db/client";
import { runDataIngestion } from "@/lib/ingestion/service";
import type { DataDomain, IngestionReport } from "@/lib/ingestion/types";

loadEnvConfig(process.cwd());

const USAGE = `Usage:
  pnpm ingest markets [--dry-run] [--symbols AAPL,MSFT] [--backfill-days 730]
  pnpm ingest sports  [--dry-run] [--leagues 39,140]`;

function fail(message: string): never {
  console.error(`✖ ${message}\n\n${USAGE}`);
  process.exit(2);
}

function parseList<T>(raw: string | undefined, parse: (item: string) => T | null, label: string) {
  if (raw === undefined) return undefined;
  const items = raw.split(/[\s,]+/).filter(Boolean);
  const parsed = items.map((item) => parse(item));
  if (items.length === 0 || parsed.some((item) => item === null)) fail(`Invalid ${label}: ${raw}`);
  return parsed as T[];
}

function print(report: IngestionReport): void {
  const icon = { succeeded: "✔", partial: "⚠", skipped: "•", failed: "✖" }[report.status];
  const seconds = (Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1_000;
  console.info(
    `${icon} ${report.domain} ingestion ${report.status}${report.dryRun ? " (dry run)" : ""} — ` +
      `${report.provider}, ${report.requestCount} requests, ${report.rowsWritten} rows, ${seconds.toFixed(1)}s`,
  );
  for (const item of report.items) {
    console.info(
      `  ${item.status.padEnd(9)} ${(item.label ?? item.key).padEnd(28)} ${String(item.rowsWritten).padStart(6)} rows` +
        `${item.lastDataDate ? `  through ${item.lastDataDate}` : ""}`,
    );
    if (item.detail) console.info(`            ${item.detail}`);
    for (const warning of item.warnings ?? []) console.warn(`            ! ${warning}`);
  }
  for (const warning of report.warnings) console.warn(`  ! ${warning}`);
  if (report.error) console.error(`  ${report.error}`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      symbols: { type: "string" },
      leagues: { type: "string" },
      "backfill-days": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.info(USAGE);
    return;
  }
  const domain = positionals[0];
  if (domain !== "markets" && domain !== "sports") fail("Choose a domain: markets or sports.");

  const symbols = parseList(
    values.symbols,
    (item) => (/^[A-Z][A-Z.]{0,9}$/.test(item.toUpperCase()) ? item.toUpperCase() : null),
    "--symbols",
  );
  const leagues = parseList(
    values.leagues,
    (item) => (/^\d{1,6}$/.test(item) && Number(item) > 0 ? Number(item) : null),
    "--leagues",
  );
  const backfillDays =
    values["backfill-days"] === undefined ? undefined : Number(values["backfill-days"]);
  if (backfillDays !== undefined && (!Number.isInteger(backfillDays) || backfillDays < 90)) {
    fail("--backfill-days must be a whole number of at least 90.");
  }

  const report = await runDataIngestion({
    domain: domain as DataDomain,
    trigger: "manual",
    dryRun: values["dry-run"],
    symbols,
    leagues,
    backfillDays,
  });
  print(report);
  if (report.status === "failed") process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error("✖ Ingestion failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
