/**
 * Shared vocabulary for scheduled data ingestion (licensed market and sports data → PostgreSQL).
 */

export type DataDomain = "markets" | "sports";
export type IngestionStatus = "running" | "succeeded" | "partial" | "failed" | "abandoned";
export type IngestionTrigger = "schedule" | "manual";

export type IngestionItemStatus = "updated" | "unchanged" | "restated" | "skipped" | "failed";

/** Outcome for one unit of work: a symbol or a competition season. */
export interface IngestionItem {
  key: string;
  label?: string;
  status: IngestionItemStatus;
  rowsWritten: number;
  /** Latest data point now stored (bar date or kick-off date). */
  lastDataDate?: string | null;
  detail?: string;
  warnings?: string[];
}

export interface IngestionReport {
  runId: string | null;
  domain: DataDomain;
  provider: string;
  trigger: IngestionTrigger;
  dryRun: boolean;
  status: Exclude<IngestionStatus, "running" | "abandoned"> | "skipped";
  startedAt: string;
  finishedAt: string;
  requestCount: number;
  rowsWritten: number;
  items: IngestionItem[];
  warnings: string[];
  error: string | null;
}

export interface IngestionRunRecord {
  id: string;
  domain: DataDomain;
  provider: string;
  trigger: IngestionTrigger;
  status: IngestionStatus;
  startedAt: string;
  finishedAt: string | null;
  requestCount: number;
  rowsWritten: number;
  items: IngestionItem[];
  warnings: string[];
  error: string | null;
}

export interface IngestionRunStore {
  /**
   * Open a run. Returns null when another run for the domain is still in progress (runs older
   * than `staleAfterMs` are marked abandoned first).
   */
  start(input: {
    domain: DataDomain;
    provider: string;
    trigger: IngestionTrigger;
    startedAt: Date;
    staleAfterMs: number;
  }): Promise<{ id: string } | null>;
  finish(
    id: string,
    result: {
      status: Exclude<IngestionStatus, "running">;
      finishedAt: Date;
      requestCount: number;
      rowsWritten: number;
      items: IngestionItem[];
      warnings: string[];
      error: string | null;
    },
  ): Promise<void>;
  recent(domain: DataDomain, limit: number): Promise<IngestionRunRecord[]>;
}
