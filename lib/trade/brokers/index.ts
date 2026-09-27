import { ConfigurationError } from "@/lib/api/errors";
import { getNow } from "@/lib/clock";
import { getServerEnv } from "@/lib/env";
import { getMarketDataProvider } from "@/lib/markets/providers";
import { PaperBrokerAdapter } from "@/lib/trade/brokers/paper-broker";
import type { BrokerAdapter } from "@/lib/trade/brokers/types";
import { buildDemoAccount } from "@/lib/trade/demo-portfolio";
import { getPaperTradingStore, type PaperTradingStore } from "@/lib/trade/store";

export type { AccountOwner, BrokerAdapter, PlaceOrderResult } from "@/lib/trade/brokers/types";

export function createPaperBroker(store: PaperTradingStore): PaperBrokerAdapter {
  const marketData = getMarketDataProvider();
  return new PaperBrokerAdapter({
    store,
    marketData,
    now: getNow,
    createAccount: async (owner, mode) => {
      const session = marketData.getSession();
      const assets = await marketData.listAssets();
      const barsBySymbol = new Map(
        await Promise.all(
          assets.map(
            async (asset) =>
              [asset.symbol, await marketData.getDailyBars(asset.symbol, { limit: 320 })] as const,
          ),
        ),
      );
      return buildDemoAccount({
        accountId: owner.accountId,
        ownerId: owner.ownerId,
        lastCompletedDate: session.lastCompletedDate,
        barsBySymbol,
        mode,
      });
    },
  });
}

/**
 * The configured broker adapter. Anything other than "paper" is refused: live execution is
 * disabled by design until the Phase 5 controls exist.
 */
export function getBrokerAdapter(store?: PaperTradingStore): BrokerAdapter {
  const id = getServerEnv().BROKER_ADAPTER;
  if (id !== "paper") {
    throw new ConfigurationError(
      `Broker adapter "${id}" is not enabled. Live execution is disabled by design in this release.`,
    );
  }
  return createPaperBroker(store ?? getPaperTradingStore());
}
