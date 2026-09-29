import { getDb } from "@/db/client";
import { readMarketSnapshot } from "@/db/repositories/market-data";
import { ConfigurationError } from "@/lib/api/errors";
import { addDays, getNow, toIsoDate } from "@/lib/clock";
import { getServerEnv } from "@/lib/env";
import { DemoMarketDataProvider } from "@/lib/markets/providers/demo-provider";
import { MARKET_DATA_PROVIDERS } from "@/lib/markets/providers/registry";
import { StoredMarketDataProvider } from "@/lib/markets/providers/stored-provider";
import type { MarketDataProvider } from "@/lib/markets/providers/types";
import { DEMO_SYMBOLS } from "@/lib/markets/universe";
import { renderAtRequestTime } from "@/lib/request-time";

export type { MarketDataProvider } from "@/lib/markets/providers/types";

/** History loaded into memory for analysis (the charts show two years). */
const SERVED_HISTORY_DAYS = 10 * 365;

let provider: MarketDataProvider | null = null;

/** Resolve the configured market data provider (MARKET_DATA_PROVIDER, default "demo"). */
export function getMarketDataProvider(): MarketDataProvider {
  if (provider) return provider;
  const env = getServerEnv();
  const id = env.MARKET_DATA_PROVIDER;
  switch (id) {
    case "demo":
      provider = new DemoMarketDataProvider();
      return provider;
    case "polygon": {
      if (!env.DATABASE_URL) {
        throw new ConfigurationError(
          "MARKET_DATA_PROVIDER=polygon requires DATABASE_URL: ingested bars are served from PostgreSQL.",
        );
      }
      const symbols = env.MARKET_DATA_SYMBOLS;
      provider = new StoredMarketDataProvider({
        id: "polygon",
        displayName: "Polygon.io end-of-day",
        symbols,
        beforeRead: renderAtRequestTime,
        load: () =>
          readMarketSnapshot(
            getDb(),
            "polygon",
            symbols,
            addDays(toIsoDate(getNow()), -SERVED_HISTORY_DAYS),
          ),
      });
      return provider;
    }
    default: {
      const descriptor = MARKET_DATA_PROVIDERS.find((entry) => entry.id === id);
      throw new ConfigurationError(
        `Market data provider "${descriptor?.name ?? id}" is planned but not implemented yet. ` +
          `Set MARKET_DATA_PROVIDER=demo or implement MarketDataProvider (docs/MARKETS_ENGINE.md).`,
      );
    }
  }
}

/**
 * Symbols the configured provider covers, without touching any data store — for static route
 * generation. Licensed providers may still withhold a symbol until enough history is ingested.
 */
export function configuredMarketSymbols(): string[] {
  const env = getServerEnv();
  return env.MARKET_DATA_PROVIDER === "demo" ? [...DEMO_SYMBOLS] : [...env.MARKET_DATA_SYMBOLS];
}

/** Test helper. */
export function setMarketDataProviderForTesting(next: MarketDataProvider | null): void {
  provider = next;
}
