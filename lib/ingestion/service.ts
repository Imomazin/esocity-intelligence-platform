import { getDb } from "@/db/client";
import { PostgresIngestionRunStore } from "@/db/repositories/ingestion-runs";
import { PostgresMarketDataRepository } from "@/db/repositories/market-data";
import { PostgresSportsRepository } from "@/db/repositories/sports-data";
import { ConfigurationError } from "@/lib/api/errors";
import { getServerEnv } from "@/lib/env";
import { runIngestion } from "@/lib/ingestion/runner";
import type { DataDomain, IngestionReport, IngestionTrigger } from "@/lib/ingestion/types";
import { ingestMarketHistory } from "@/lib/markets/ingestion";
import { getMarketDataProvider } from "@/lib/markets/providers";
import { PolygonHistorySource } from "@/lib/markets/providers/polygon";
import { StoredMarketDataProvider } from "@/lib/markets/providers/stored-provider";
import { findDemoAsset } from "@/lib/markets/universe";
import { ingestFootball } from "@/lib/sports/ingestion";
import { getSportsDataProvider } from "@/lib/sports/providers";
import { ApiFootballSource } from "@/lib/sports/providers/api-football";
import { StoredSportsDataProvider } from "@/lib/sports/providers/stored-provider";

/**
 * Entry point shared by the cron route and the `pnpm ingest` CLI: turns configuration into a
 * provider source, repositories and a run log, then runs the domain's ingestion.
 */

export interface IngestionRequest {
  domain: DataDomain;
  trigger: IngestionTrigger;
  dryRun?: boolean;
  /** Markets only: override the configured universe (e.g. backfill a new symbol first). */
  symbols?: readonly string[];
  /** Sports only: override the configured leagues. */
  leagues?: readonly number[];
  backfillDays?: number;
  /** Stop starting new items after this long (serverless time limits). */
  timeBudgetMs?: number;
}

function skipped(request: IngestionRequest, provider: string, reason: string): IngestionReport {
  const now = new Date().toISOString();
  return {
    runId: null,
    domain: request.domain,
    provider,
    trigger: request.trigger,
    dryRun: Boolean(request.dryRun),
    status: "skipped",
    startedAt: now,
    finishedAt: now,
    requestCount: 0,
    rowsWritten: 0,
    items: [],
    warnings: [],
    error: reason,
  };
}

export async function runDataIngestion(request: IngestionRequest): Promise<IngestionReport> {
  const env = getServerEnv();
  const dryRun = Boolean(request.dryRun);
  if (!dryRun && !env.DATABASE_URL) {
    throw new ConfigurationError("DATABASE_URL is required to store ingested data.");
  }
  const db = dryRun ? null : getDb();
  const store = db ? new PostgresIngestionRunStore(db) : null;

  if (request.domain === "markets") {
    const provider = env.MARKET_DATA_PROVIDER;
    if (provider === "demo") {
      return skipped(
        request,
        provider,
        "MARKET_DATA_PROVIDER=demo — synthetic data needs no ingestion.",
      );
    }
    if (provider !== "polygon") {
      throw new ConfigurationError(`No ingestion source is implemented for "${provider}".`);
    }
    if (!env.POLYGON_API_KEY) throw new ConfigurationError("POLYGON_API_KEY is not set.");
    const source = new PolygonHistorySource({
      apiKey: env.POLYGON_API_KEY,
      baseUrl: env.POLYGON_BASE_URL,
      requestsPerMinute: env.POLYGON_REQUESTS_PER_MINUTE,
    });
    const report = await runIngestion({
      domain: "markets",
      provider,
      trigger: request.trigger,
      dryRun,
      store,
      timeBudgetMs: request.timeBudgetMs,
      work: (context) =>
        ingestMarketHistory(
          {
            source,
            repository: db ? new PostgresMarketDataRepository(db) : null,
            symbols: request.symbols ?? env.MARKET_DATA_SYMBOLS,
            backfillDays: request.backfillDays ?? env.MARKET_DATA_BACKFILL_DAYS,
            curatedProfile: (symbol) => findDemoAsset(symbol)?.profile ?? null,
          },
          context,
        ),
    });
    if (!dryRun) {
      const served = getMarketDataProvider();
      if (served instanceof StoredMarketDataProvider) served.invalidate();
    }
    return report;
  }

  const provider = env.SPORTS_DATA_PROVIDER;
  if (provider === "demo") {
    return skipped(
      request,
      provider,
      "SPORTS_DATA_PROVIDER=demo — synthetic data needs no ingestion.",
    );
  }
  if (provider !== "api-football") {
    throw new ConfigurationError(`No ingestion source is implemented for "${provider}".`);
  }
  if (!env.API_FOOTBALL_KEY) throw new ConfigurationError("API_FOOTBALL_KEY is not set.");
  const source = new ApiFootballSource({
    apiKey: env.API_FOOTBALL_KEY,
    baseUrl: env.API_FOOTBALL_BASE_URL,
    maxRequests: env.API_FOOTBALL_MAX_REQUESTS_PER_RUN,
    requestsPerMinute: env.API_FOOTBALL_REQUESTS_PER_MINUTE,
  });
  const report = await runIngestion({
    domain: "sports",
    provider,
    trigger: request.trigger,
    dryRun,
    store,
    timeBudgetMs: request.timeBudgetMs,
    work: (context) =>
      ingestFootball(
        {
          source,
          repository: db ? new PostgresSportsRepository(db) : null,
          leagues: request.leagues ?? env.API_FOOTBALL_LEAGUES,
          season: env.API_FOOTBALL_SEASON,
        },
        context,
      ),
  });
  if (!dryRun) {
    const served = getSportsDataProvider();
    if (served instanceof StoredSportsDataProvider) served.invalidate();
  }
  return report;
}
