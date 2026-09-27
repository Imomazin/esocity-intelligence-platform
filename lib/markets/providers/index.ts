import { ConfigurationError } from "@/lib/api/errors";
import { getServerEnv } from "@/lib/env";
import { DemoMarketDataProvider } from "@/lib/markets/providers/demo-provider";
import { MARKET_DATA_PROVIDERS } from "@/lib/markets/providers/registry";
import type { MarketDataProvider } from "@/lib/markets/providers/types";

export type { MarketDataProvider } from "@/lib/markets/providers/types";

let provider: MarketDataProvider | null = null;

/** Resolve the configured market data provider (MARKET_DATA_PROVIDER, default "demo"). */
export function getMarketDataProvider(): MarketDataProvider {
  if (provider) return provider;
  const id = getServerEnv().MARKET_DATA_PROVIDER;
  switch (id) {
    case "demo":
      provider = new DemoMarketDataProvider();
      return provider;
    default: {
      const descriptor = MARKET_DATA_PROVIDERS.find((entry) => entry.id === id);
      throw new ConfigurationError(
        `Market data provider "${descriptor?.name ?? id}" is planned but not implemented yet. ` +
          `Set MARKET_DATA_PROVIDER=demo or implement MarketDataProvider (docs/MARKETS_ENGINE.md).`,
      );
    }
  }
}

/** Test helper. */
export function setMarketDataProviderForTesting(next: MarketDataProvider | null): void {
  provider = next;
}
