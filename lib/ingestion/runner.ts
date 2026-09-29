import { recordAuditEvent } from "@/lib/audit";
import type {
  DataDomain,
  IngestionItem,
  IngestionReport,
  IngestionRunStore,
  IngestionTrigger,
} from "@/lib/ingestion/types";
import { logger } from "@/lib/logger";
import { isProviderError } from "@/lib/providers/errors";

/** A run left RUNNING for longer than this is assumed dead and marked abandoned. */
export const STALE_RUN_AFTER_MS = 20 * 60_000;

export interface IngestionContext {
  now: () => Date;
  dryRun: boolean;
  /** True once the run's time budget is spent; workers stop between items. */
  outOfTime: () => boolean;
}

export interface IngestionWorkResult {
  items: IngestionItem[];
  warnings: string[];
  requestCount: number;
}

export interface RunIngestionOptions {
  domain: DataDomain;
  provider: string;
  trigger: IngestionTrigger;
  dryRun: boolean;
  /** Null for dry runs: nothing is written, not even the run log. */
  store: IngestionRunStore | null;
  timeBudgetMs?: number;
  now?: () => Date;
  work: (context: IngestionContext) => Promise<IngestionWorkResult>;
}

/** Messages persisted and shown to operators: provider errors are safe; others are opaque. */
function safeMessage(error: unknown): string {
  if (isProviderError(error)) return error.message;
  return "Unexpected error during ingestion — see the server logs for details.";
}

export function overallStatus(items: readonly IngestionItem[]): IngestionReport["status"] {
  if (items.length === 0) return "succeeded";
  const failed = items.filter((item) => item.status === "failed").length;
  if (failed === items.length) return "failed";
  if (failed > 0 || items.some((item) => item.status === "skipped")) return "partial";
  return "succeeded";
}

/**
 * Run one ingestion job: take the per-domain lease, execute the work within its time budget,
 * record the outcome and audit it. Never throws for provider or data failures — they are
 * captured in the report (and the run log) so schedulers see a structured result.
 */
export async function runIngestion(options: RunIngestionOptions): Promise<IngestionReport> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const deadline =
    options.timeBudgetMs === undefined ? null : startedAt.getTime() + options.timeBudgetMs;
  const base = {
    domain: options.domain,
    provider: options.provider,
    trigger: options.trigger,
    dryRun: options.dryRun,
    startedAt: startedAt.toISOString(),
  };

  const lease = options.store
    ? await options.store.start({
        domain: options.domain,
        provider: options.provider,
        trigger: options.trigger,
        startedAt,
        staleAfterMs: STALE_RUN_AFTER_MS,
      })
    : null;
  if (options.store && !lease) {
    return {
      ...base,
      runId: null,
      status: "skipped",
      finishedAt: now().toISOString(),
      requestCount: 0,
      rowsWritten: 0,
      items: [],
      warnings: [],
      error: `Another ${options.domain} ingestion run is in progress.`,
    };
  }

  let report: IngestionReport;
  try {
    const result = await options.work({
      now,
      dryRun: options.dryRun,
      outOfTime: () => deadline !== null && now().getTime() >= deadline,
    });
    report = {
      ...base,
      runId: lease?.id ?? null,
      status: overallStatus(result.items),
      finishedAt: now().toISOString(),
      requestCount: result.requestCount,
      rowsWritten: result.items.reduce((total, item) => total + item.rowsWritten, 0),
      items: result.items,
      warnings: result.warnings,
      error: null,
    };
  } catch (error) {
    logger.error("ingestion.failed", { domain: options.domain, provider: options.provider, error });
    report = {
      ...base,
      runId: lease?.id ?? null,
      status: "failed",
      finishedAt: now().toISOString(),
      requestCount: 0,
      rowsWritten: 0,
      items: [],
      warnings: [],
      error: safeMessage(error),
    };
  }

  if (options.store && lease) {
    await options.store.finish(lease.id, {
      status: report.status === "skipped" ? "failed" : report.status,
      finishedAt: new Date(report.finishedAt),
      requestCount: report.requestCount,
      rowsWritten: report.rowsWritten,
      items: report.items,
      warnings: report.warnings,
      error: report.error,
    });
  }

  logger.info("ingestion.completed", {
    domain: report.domain,
    provider: report.provider,
    trigger: report.trigger,
    dryRun: report.dryRun,
    status: report.status,
    rowsWritten: report.rowsWritten,
    requestCount: report.requestCount,
    items: report.items.length,
  });

  if (!options.dryRun) {
    await recordAuditEvent({
      action: "ingestion.run",
      actorType: options.trigger === "schedule" ? "system" : "service",
      actorId: `ingestion:${options.domain}`,
      resourceType: "ingestion_run",
      resourceId: report.runId ?? undefined,
      outcome: report.status === "failed" ? "failure" : "success",
      metadata: {
        domain: report.domain,
        provider: report.provider,
        status: report.status,
        rowsWritten: report.rowsWritten,
        requestCount: report.requestCount,
        items: report.items.length,
      },
    });
  }
  return report;
}
