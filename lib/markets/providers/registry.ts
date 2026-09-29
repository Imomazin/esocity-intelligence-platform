import type { MarketDataProviderId } from "@/lib/env";

/**
 * Market data provider registry.
 *
 * `demo` (synthetic) and `polygon` (licensed, ingested into PostgreSQL) are implemented. The
 * remaining entries are documented placeholders: each lists the environment variables it will
 * need and the integration notes an engineer needs to add an ingestion source for it (see
 * docs/MARKETS_ENGINE.md → "Adding a provider"). Selecting a planned provider fails loudly at
 * runtime rather than silently serving demo data in its place.
 */

export type ProviderStatus = "available" | "planned";

export interface ProviderDescriptor<Id extends string> {
  id: Id;
  name: string;
  status: ProviderStatus;
  coverage: string;
  envVars: string[];
  notes: string;
}

export const MARKET_DATA_PROVIDERS: ProviderDescriptor<MarketDataProviderId>[] = [
  {
    id: "demo",
    name: "Esocity synthetic market",
    status: "available",
    coverage: "8 US equities/ETFs, daily bars since 2022, simulated intraday quotes",
    envVars: [],
    notes: "Deterministic, key-free. Default for demo deployments and tests.",
  },
  {
    id: "polygon",
    name: "Polygon.io (Massive)",
    status: "available",
    coverage:
      "US equities and ETFs — split-adjusted daily bars and reference data, ingested into PostgreSQL",
    envVars: [
      "POLYGON_API_KEY",
      "MARKET_DATA_SYMBOLS",
      "POLYGON_REQUESTS_PER_MINUTE",
      "DATABASE_URL",
      "CRON_SECRET",
    ],
    notes:
      "Scheduled end-of-day ingestion (/api/cron/ingest/markets or `pnpm ingest markets`) with validation and split/restatement detection; pages read PostgreSQL, never the API. Quotes are the last close (delayed).",
  },
  {
    id: "twelvedata",
    name: "Twelve Data",
    status: "planned",
    coverage: "Global equities, ETFs, FX, crypto — time series and technical indicators",
    envVars: ["TWELVE_DATA_API_KEY"],
    notes: "Respect per-minute credit limits; cache time series in Redis.",
  },
  {
    id: "alphavantage",
    name: "Alpha Vantage",
    status: "planned",
    coverage: "Equities, FX, crypto — daily adjusted series, fundamentals",
    envVars: ["ALPHA_VANTAGE_API_KEY"],
    notes: "Low free-tier limits: ingest on a schedule into market_prices rather than per request.",
  },
  {
    id: "fmp",
    name: "Financial Modeling Prep",
    status: "planned",
    coverage: "Equities — prices, fundamentals, estimates, calendars",
    envVars: ["FMP_API_KEY"],
    notes: "Useful for fundamentals-based features in Phase 3.",
  },
  {
    id: "enterprise",
    name: "Bloomberg / LSEG (Refinitiv) enterprise feeds",
    status: "planned",
    coverage: "Institutional real-time and reference data",
    envVars: ["ENTERPRISE_FEED_ENDPOINT", "ENTERPRISE_FEED_CREDENTIALS"],
    notes:
      "Licensed, entitlement-controlled distribution. Requires a dedicated ingestion service and contractual review before any display.",
  },
];
