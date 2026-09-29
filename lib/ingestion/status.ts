import { getDb } from "@/db/client";
import { PostgresIngestionRunStore } from "@/db/repositories/ingestion-runs";
import { readMarketCoverage } from "@/db/repositories/market-data";
import { readFootballCoverage } from "@/db/repositories/sports-data";
import { getNow } from "@/lib/clock";
import {
  getServerEnv,
  IMPLEMENTED_MARKET_PROVIDERS,
  IMPLEMENTED_SPORTS_PROVIDERS,
} from "@/lib/env";
import {
  assessMarketPipeline,
  assessSportsPipeline,
  type CompetitionFreshness,
  type PipelineAssessment,
  type SymbolFreshness,
} from "@/lib/ingestion/monitoring";
import type { DataDomain, IngestionRunRecord } from "@/lib/ingestion/types";
import { competitionKey } from "@/lib/sports/ingestion";

/**
 * Live pipeline status for licensed data providers, read from PostgreSQL. Returns null for a
 * domain served by the synthetic demo provider (there is nothing to ingest or monitor).
 */

export interface PipelineStatusView<T> {
  domain: DataDomain;
  provider: string;
  assessment: PipelineAssessment<T>;
  runs: IngestionRunRecord[];
}

const RECENT_RUNS = 10;

export async function marketPipelineStatus(
  now: Date = getNow(),
): Promise<PipelineStatusView<SymbolFreshness> | null> {
  const env = getServerEnv();
  const provider = env.MARKET_DATA_PROVIDER;
  if (provider === "demo" || !IMPLEMENTED_MARKET_PROVIDERS.includes(provider)) return null;
  const db = getDb();
  const [coverage, runs] = await Promise.all([
    readMarketCoverage(db, provider, env.MARKET_DATA_SYMBOLS),
    new PostgresIngestionRunStore(db).recent("markets", RECENT_RUNS),
  ]);
  return {
    domain: "markets",
    provider,
    assessment: assessMarketPipeline(coverage, runs, now),
    runs,
  };
}

export async function sportsPipelineStatus(
  now: Date = getNow(),
): Promise<PipelineStatusView<CompetitionFreshness> | null> {
  const env = getServerEnv();
  const provider = env.SPORTS_DATA_PROVIDER;
  if (provider === "demo" || !IMPLEMENTED_SPORTS_PROVIDERS.includes(provider)) return null;
  const db = getDb();
  const [coverage, runs] = await Promise.all([
    readFootballCoverage(db, env.API_FOOTBALL_LEAGUES.map(competitionKey), now),
    new PostgresIngestionRunStore(db).recent("sports", RECENT_RUNS),
  ]);
  return {
    domain: "sports",
    provider,
    assessment: assessSportsPipeline(coverage, runs, now),
    runs,
  };
}
