import type { MarketDataProviderId } from "@/lib/env";

/**
 * Market data provider registry.
 *
 * Only `demo` is implemented in Phase 1. The remaining entries are documented placeholders:
 * each lists the environment variables it will need and the integration notes an engineer
 * needs to implement `MarketDataProvider` for it (see docs/MARKETS_ENGINE.md → "Adding a
 * provider"). Selecting a planned provider fails loudly at runtime rather than silently
 * serving demo data in its place.
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
    name: "Polygon.io",
    status: "planned",
    coverage: "US equities, options, FX, crypto — aggregates, trades, quotes, websockets",
    envVars: ["POLYGON_API_KEY"],
    notes: "Use /v2/aggs for daily bars; websocket feed for live quotes via a background worker.",
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
