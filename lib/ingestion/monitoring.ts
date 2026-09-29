import { getUsMarketSession, type TradingCalendar } from "@/lib/clock";
import type { IngestionRunRecord } from "@/lib/ingestion/types";
import { NYSE_CALENDAR, tradingSessionsAfter } from "@/lib/markets/calendar";
import { MIN_ANALYSIS_BARS } from "@/lib/markets/providers/stored-provider";

/**
 * Data-quality and freshness assessment for licensed data (pure — callers supply the stored
 * coverage and the run log).
 *
 *   Markets: each symbol's last stored bar vs the last completed NYSE session. One session of
 *   lag is normal (the post-close ingestion job may not have run yet); two or more is stale.
 *   Sports: fixtures still unresolved more than a day after kick-off, and time since the last
 *   successful ingestion run.
 *
 * Domain status: `down` when nothing can be served, `degraded` when anything is stale, withheld
 * or the latest run failed, `ok` otherwise.
 */

export type PipelineStatus = "ok" | "degraded" | "down";
export type FreshnessStatus = "fresh" | "stale" | "missing";

/** Sessions of lag tolerated before a symbol counts as stale. */
export const MARKET_LAG_TOLERANCE = 1;
/** A sports ingestion older than this is stale (the job runs daily). */
export const SPORTS_MAX_AGE_MS = 36 * 3_600_000;

export interface SymbolCoverageInput {
  symbol: string;
  first: string | null;
  last: string | null;
  bars: number;
}

export interface SymbolFreshness extends SymbolCoverageInput {
  expectedDate: string;
  sessionsBehind: number | null;
  status: FreshnessStatus;
  /** Enough history to be analysed and shown. */
  servable: boolean;
}

export interface CompetitionCoverageInput {
  key: string;
  name: string;
  season: string;
  fixtures: number;
  finished: number;
  upcoming: number;
  overdue: number;
  withXg: number;
  lastResult: string | null;
  lastUpdated: string | null;
}

export interface CompetitionFreshness extends CompetitionCoverageInput {
  status: FreshnessStatus;
  xgCoverage: number | null;
}

export interface PipelineAssessment<T> {
  status: PipelineStatus;
  summary: string;
  items: T[];
  lastRun: IngestionRunRecord | null;
  lastSuccess: IngestionRunRecord | null;
}

function runSummary(runs: readonly IngestionRunRecord[]) {
  const finished = runs.filter((run) => run.status !== "running");
  return {
    lastRun: finished[0] ?? null,
    lastSuccess:
      finished.find((run) => run.status === "succeeded" || run.status === "partial") ?? null,
  };
}

export function assessSymbol(
  coverage: SymbolCoverageInput,
  now: Date,
  calendar: TradingCalendar = NYSE_CALENDAR,
): SymbolFreshness {
  const expectedDate = getUsMarketSession(now, calendar).lastCompletedDate;
  if (!coverage.last || coverage.bars === 0) {
    return { ...coverage, expectedDate, sessionsBehind: null, status: "missing", servable: false };
  }
  const sessionsBehind = tradingSessionsAfter(calendar, coverage.last, expectedDate);
  return {
    ...coverage,
    expectedDate,
    sessionsBehind,
    status: sessionsBehind > MARKET_LAG_TOLERANCE ? "stale" : "fresh",
    servable: coverage.bars >= MIN_ANALYSIS_BARS,
  };
}

export function assessMarketPipeline(
  coverage: readonly SymbolCoverageInput[],
  runs: readonly IngestionRunRecord[],
  now: Date,
): PipelineAssessment<SymbolFreshness> {
  const items = coverage.map((entry) => assessSymbol(entry, now));
  const { lastRun, lastSuccess } = runSummary(runs);
  const servable = items.filter((item) => item.servable).length;
  const stale = items.filter((item) => item.status === "stale").length;
  const missing = items.filter((item) => item.status === "missing" || !item.servable).length;

  let status: PipelineStatus = "ok";
  if (servable === 0) status = "down";
  else if (stale > 0 || missing > 0 || lastRun?.status === "failed") status = "degraded";

  const latest = items
    .map((item) => item.last)
    .filter((date): date is string => date !== null)
    .sort()
    .at(-1);
  const parts = [
    `${servable}/${items.length} symbols servable`,
    latest ? `latest bar ${latest}` : "no bars stored",
  ];
  if (stale > 0) parts.push(`${stale} stale`);
  if (lastRun?.status === "failed") parts.push("last run failed");
  return { status, summary: parts.join(" · "), items, lastRun, lastSuccess };
}

export function assessCompetition(coverage: CompetitionCoverageInput): CompetitionFreshness {
  const status: FreshnessStatus =
    coverage.fixtures === 0 ? "missing" : coverage.overdue > 0 ? "stale" : "fresh";
  return {
    ...coverage,
    status,
    xgCoverage: coverage.finished > 0 ? coverage.withXg / coverage.finished : null,
  };
}

export function assessSportsPipeline(
  coverage: readonly CompetitionCoverageInput[],
  runs: readonly IngestionRunRecord[],
  now: Date,
): PipelineAssessment<CompetitionFreshness> {
  const items = coverage.map(assessCompetition);
  const { lastRun, lastSuccess } = runSummary(runs);
  const available = items.filter((item) => item.status !== "missing").length;
  const overdue = items.reduce((total, item) => total + item.overdue, 0);
  const successAge = lastSuccess?.finishedAt
    ? now.getTime() - Date.parse(lastSuccess.finishedAt)
    : null;
  const oldRun = successAge === null || successAge > SPORTS_MAX_AGE_MS;

  let status: PipelineStatus = "ok";
  if (available === 0) status = "down";
  else if (overdue > 0 || oldRun || items.some((item) => item.status === "missing")) {
    status = "degraded";
  } else if (lastRun?.status === "failed") status = "degraded";

  const parts = [`${available}/${items.length} competitions available`];
  if (overdue > 0) parts.push(`${overdue} results overdue`);
  if (oldRun) parts.push(lastSuccess ? "last successful run over 36 h ago" : "never ingested");
  if (lastRun?.status === "failed") parts.push("last run failed");
  return { status, summary: parts.join(" · "), items, lastRun, lastSuccess };
}
