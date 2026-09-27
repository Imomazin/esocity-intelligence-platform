import type { MarketDataProvider } from "@/lib/markets/providers/types";
import type { AccountOwner, BrokerAdapter, PlaceOrderResult } from "@/lib/trade/brokers/types";
import { replayLedger } from "@/lib/trade/ledger";
import { validateOrder } from "@/lib/trade/order-validation";
import type { PaperTradingStore } from "@/lib/trade/store/types";
import type { OrderRequest, PaperAccountRecord, PaperOrder } from "@/lib/trade/types";

export interface PaperBrokerDependencies {
  store: PaperTradingStore;
  marketData: MarketDataProvider;
  /** Builds the initial account for a new owner (seeded demo portfolio or cash-only). */
  createAccount: (owner: AccountOwner, mode: "demo" | "cash") => Promise<PaperAccountRecord>;
  now?: () => Date;
  newId?: () => string;
}

/**
 * Simulated broker. Market orders fill immediately at the current (simulated) quote adjusted
 * for slippage, plus commission. NO REAL ORDERS ARE EVER ROUTED ANYWHERE.
 */
export class PaperBrokerAdapter implements BrokerAdapter {
  readonly id = "paper" as const;
  readonly mode = "paper" as const;
  readonly displayName = "Esocity Paper Broker (simulated)";

  constructor(private readonly deps: PaperBrokerDependencies) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private newId(): string {
    return this.deps.newId?.() ?? crypto.randomUUID();
  }

  async getAccount(owner: AccountOwner): Promise<PaperAccountRecord | null> {
    return this.deps.store.load(owner.accountId);
  }

  async placeOrder(owner: AccountOwner, request: OrderRequest): Promise<PlaceOrderResult> {
    const symbol = request.symbol.trim().toUpperCase();
    const assets = await this.deps.marketData.listAssets();
    const knownSymbols = new Set(assets.map((asset) => asset.symbol));
    const quotes = new Map(
      await Promise.all(
        assets.map(
          async (asset) =>
            [asset.symbol, await this.deps.marketData.getQuote(asset.symbol)] as const,
        ),
      ),
    );
    const existing = await this.deps.store.load(owner.accountId);
    const seed = existing ? null : await this.deps.createAccount(owner, "demo");
    const requestedAt = this.now().toISOString();
    const orderId = this.newId();

    return this.deps.store.mutate(owner.accountId, (current) => {
      const base = current ?? seed ?? null;
      if (!base) throw new Error("Paper account could not be initialised");
      const ledger = replayLedger(base.startingCash, base.orders);
      let holdingsMarketValue = 0;
      for (const holding of ledger.holdings.values()) {
        holdingsMarketValue +=
          (quotes.get(holding.symbol)?.price ?? holding.averageCost) * holding.quantity;
      }
      const quote = quotes.get(symbol) ?? null;
      const held = ledger.holdings.get(symbol)?.quantity ?? 0;
      const validation = validateOrder(
        { ...request, symbol },
        {
          ledger,
          knownSymbols,
          referencePrice: quote?.price ?? null,
          holdingsMarketValue,
          symbolMarketValue: held * (quote?.price ?? 0),
          existingOrderCount: base.orders.length,
        },
      );

      const common = {
        id: orderId,
        accountId: base.id,
        symbol,
        side: request.side,
        type: "MARKET" as const,
        quantity: request.quantity,
        requestedAt,
        source: "user" as const,
        clientOrderId: request.clientOrderId ?? null,
      };
      const order: PaperOrder = validation.ok
        ? {
            ...common,
            status: "FILLED",
            filledAt: requestedAt,
            referencePrice: validation.estimate.referencePrice,
            fillPrice: validation.estimate.fillPrice,
            fee: validation.estimate.fee,
            notional: validation.estimate.notional,
            cashImpact: validation.estimate.cashImpact,
            realizedPnl: null,
            rejectionReason: null,
            rejectionMessage: null,
          }
        : {
            ...common,
            status: "REJECTED",
            filledAt: null,
            referencePrice: quote?.price ?? null,
            fillPrice: null,
            fee: 0,
            notional: null,
            cashImpact: 0,
            realizedPnl: null,
            rejectionReason: validation.reason,
            rejectionMessage: validation.message,
          };

      const next: PaperAccountRecord = {
        ...base,
        updatedAt: requestedAt,
        orders: [...base.orders, order],
      };
      return {
        next,
        appended: current ? [order] : next.orders,
        created: !current,
        reset: false,
        result: { order, account: next, estimate: validation.estimate },
      };
    });
  }

  async resetAccount(owner: AccountOwner, mode: "demo" | "cash"): Promise<PaperAccountRecord> {
    const fresh = await this.deps.createAccount(owner, mode);
    return this.deps.store.mutate(owner.accountId, (current) => {
      const next: PaperAccountRecord = {
        ...fresh,
        createdAt: current?.createdAt ?? fresh.createdAt,
        updatedAt: this.now().toISOString(),
      };
      return {
        next,
        appended: next.orders,
        created: !current,
        reset: Boolean(current),
        result: next,
      };
    });
  }
}
