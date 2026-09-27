import { describe, expect, it } from "vitest";

import { MemoryKeyValueStore } from "@/lib/kv/memory-store";
import type { MarketDataProvider } from "@/lib/markets/providers/types";
import { PaperBrokerAdapter } from "@/lib/trade/brokers/paper-broker";
import { commissionFor, PAPER_EXECUTION_CONFIG, simulatedFillPrice } from "@/lib/trade/execution";
import { annotateRealizedPnl, emptyLedgerState, replayLedger } from "@/lib/trade/ledger";
import {
  orderRequestSchema,
  validateOrder,
  type OrderValidationContext,
} from "@/lib/trade/order-validation";
import { summarisePortfolio } from "@/lib/trade/portfolio";
import { assessPortfolioRisk } from "@/lib/trade/risk";
import { KeyValuePaperTradingStore } from "@/lib/trade/store/kv-store";
import type { OrderSide, PaperAccountRecord, PaperOrder } from "@/lib/trade/types";

let sequence = 0;
function fill(symbol: string, side: OrderSide, quantity: number, fillPrice: number): PaperOrder {
  sequence += 1;
  const notional = fillPrice * quantity;
  const fee = commissionFor(notional);
  return {
    id: `order-${sequence}`,
    accountId: "acct",
    symbol,
    side,
    type: "MARKET",
    quantity,
    status: "FILLED",
    requestedAt: `2026-01-${String(sequence).padStart(2, "0")}T15:00:00.000Z`,
    filledAt: `2026-01-${String(sequence).padStart(2, "0")}T15:00:00.000Z`,
    referencePrice: fillPrice,
    fillPrice,
    fee,
    notional,
    cashImpact: side === "BUY" ? -(notional + fee) : notional - fee,
    realizedPnl: null,
    rejectionReason: null,
    rejectionMessage: null,
    source: "user",
    clientOrderId: null,
  };
}

function context(overrides: Partial<OrderValidationContext> = {}): OrderValidationContext {
  return {
    ledger: emptyLedgerState(10_000),
    knownSymbols: new Set(["AAPL", "MSFT"]),
    referencePrice: 100,
    holdingsMarketValue: 0,
    symbolMarketValue: 0,
    existingOrderCount: 0,
    ...overrides,
  };
}

describe("execution model", () => {
  it("applies adverse slippage and a minimum commission", () => {
    expect(simulatedFillPrice("BUY", 100)).toBe(100.05);
    expect(simulatedFillPrice("SELL", 100)).toBe(99.95);
    expect(commissionFor(100)).toBe(PAPER_EXECUTION_CONFIG.minimumCommission);
    expect(commissionFor(100_000)).toBe(50);
  });
});

describe("order request schema", () => {
  it("normalises symbols and rejects malformed input", () => {
    expect(orderRequestSchema.parse({ symbol: " aapl ", side: "BUY", quantity: 1 }).symbol).toBe(
      "AAPL",
    );
    expect(
      orderRequestSchema.safeParse({ symbol: "AAPL", side: "HOLD", quantity: 1 }).success,
    ).toBe(false);
    expect(
      orderRequestSchema.safeParse({ symbol: "AAPL", side: "BUY", quantity: "1" }).success,
    ).toBe(false);
    expect(
      orderRequestSchema.safeParse({ symbol: "<script>", side: "BUY", quantity: 1 }).success,
    ).toBe(false);
  });
});

describe("order validation", () => {
  it("accepts an affordable buy and estimates cash impact", () => {
    const result = validateOrder({ symbol: "AAPL", side: "BUY", quantity: 10 }, context());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.estimate.fillPrice).toBe(100.05);
      expect(result.estimate.cashAfter).toBeCloseTo(10_000 - 1000.5 - 1, 2);
    }
  });

  it.each([
    [{ quantity: 0 }, "INVALID_QUANTITY"],
    [{ quantity: 1.5 }, "INVALID_QUANTITY"],
    [{ quantity: 1_000_000 }, "INVALID_QUANTITY"],
    [{ symbol: "ZZZZ" }, "UNKNOWN_SYMBOL"],
    [{ quantity: 500 }, "INSUFFICIENT_CASH"],
    [{ side: "SELL" as const }, "INSUFFICIENT_POSITION"],
  ])("rejects %o with %s", (patch, reason) => {
    const result = validateOrder(
      { symbol: "AAPL", side: "BUY", quantity: 10, ...patch },
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  it("rejects when the account order limit is reached", () => {
    const result = validateOrder(
      { symbol: "AAPL", side: "BUY", quantity: 1 },
      context({ existingOrderCount: 500 }),
    );
    expect(!result.ok && result.reason).toBe("ORDER_LIMIT_REACHED");
  });

  it("warns about concentration", () => {
    const result = validateOrder({ symbol: "AAPL", side: "BUY", quantity: 60 }, context());
    expect(result.ok && result.estimate.warnings.length).toBeGreaterThan(0);
  });
});

describe("ledger accounting (average cost)", () => {
  it("capitalises buy fees and books realised P&L net of sell fees", () => {
    const orders = [
      fill("AAPL", "BUY", 10, 100),
      fill("AAPL", "BUY", 10, 110),
      fill("AAPL", "SELL", 5, 120),
    ];
    const state = replayLedger(10_000, orders);
    const holding = state.holdings.get("AAPL")!;
    const expectedAverage = (1000 + 1 + 1100 + 1) / 20; // both commissions hit the $1 minimum
    expect(holding.quantity).toBe(15);
    expect(holding.averageCost).toBeCloseTo(expectedAverage, 10);
    expect(state.realizedPnl).toBeCloseTo(600 - 1 - expectedAverage * 5, 6);
    expect(state.cash).toBeCloseTo(10_000 - 1001 - 1101 + 599, 2);
    const annotated = annotateRealizedPnl(10_000, orders);
    expect(annotated[2]?.realizedPnl).toBeCloseTo(state.realizedPnl, 2);
  });

  it("closes a position when fully sold", () => {
    const state = replayLedger(10_000, [fill("MSFT", "BUY", 5, 200), fill("MSFT", "SELL", 5, 210)]);
    expect(state.holdings.has("MSFT")).toBe(false);
    expect(state.closed.get("MSFT")).toBeDefined();
  });

  it("reconciles: cash + holdings at cost + realised = starting cash − fees + gains", () => {
    const orders = [
      fill("AAPL", "BUY", 20, 100),
      fill("MSFT", "BUY", 10, 50),
      fill("AAPL", "SELL", 20, 90),
    ];
    const state = replayLedger(10_000, orders);
    const prices = new Map([["MSFT", { price: 55, previousClose: 54, name: "Microsoft" }]]);
    const account: PaperAccountRecord = {
      id: "acct",
      ownerId: "owner",
      name: "Test",
      baseCurrency: "USD",
      startingCash: 10_000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      orders,
    };
    const { summary, exposure } = summarisePortfolio(account, state, prices);
    expect(summary.totalValue).toBeCloseTo(summary.cash + summary.marketValue, 2);
    expect(summary.totalPnl).toBeCloseTo(summary.realizedPnl + summary.unrealizedPnl, 1);
    expect(exposure.reduce((total, slice) => total + slice.weight, 0)).toBeCloseTo(1, 5);
  });
});

describe("portfolio risk", () => {
  it("scores and grades transparently", () => {
    const base = {
      startingCash: 100_000,
      cash: 50_000,
      marketValue: 50_000,
      totalValue: 100_000,
      investedCapital: 50_000,
      unrealizedPnl: 0,
      unrealizedReturn: 0,
      realizedPnl: 0,
      totalPnl: 0,
      totalReturn: 0,
      feesPaid: 0,
      dayChange: 0,
      dayChangePercent: 0,
      cashWeight: 0.5,
      grossExposure: 0.5,
      largestPosition: { symbol: "AAPL", weight: 0.1 },
      herfindahlIndex: 0.05,
    };
    const calm = assessPortfolioRisk({ summary: base, volatility: 0.08, maxDrawdown: 0 });
    expect(calm.score).toBe(0);
    expect(calm.level).toBe("LOW");
    const stressed = assessPortfolioRisk({
      summary: {
        ...base,
        cashWeight: 0.01,
        grossExposure: 0.99,
        largestPosition: { symbol: "TSLA", weight: 0.6 },
      },
      volatility: 0.45,
      maxDrawdown: -0.3,
    });
    expect(stressed.level).toBe("VERY_HIGH");
    expect(stressed.factors.reduce((total, factor) => total + factor.points, 0)).toBeCloseTo(
      stressed.score,
      0,
    );
    expect(stressed.warnings.length).toBeGreaterThanOrEqual(3);
  });
});

describe("paper broker", () => {
  const marketData = {
    id: "demo",
    displayName: "Test",
    isSimulated: true,
    listAssets: async () => [{ symbol: "AAPL" }, { symbol: "MSFT" }],
    getQuote: async (symbol: string) => ({ symbol, price: symbol === "AAPL" ? 100 : 200 }),
  } as unknown as MarketDataProvider;

  function broker() {
    const store = new KeyValuePaperTradingStore(new MemoryKeyValueStore());
    return new PaperBrokerAdapter({
      store,
      marketData,
      createAccount: async (owner) => ({
        id: owner.accountId,
        ownerId: owner.ownerId,
        name: "Test",
        baseCurrency: "USD",
        startingCash: 10_000,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        orders: [],
      }),
      now: () => new Date("2026-09-25T15:00:00Z"),
    });
  }
  const owner = { accountId: "11111111-1111-4111-8111-111111111111", ownerId: "owner" };

  it("fills valid orders and records rejections without changing cash", async () => {
    const adapter = broker();
    const filled = await adapter.placeOrder(owner, { symbol: "AAPL", side: "BUY", quantity: 10 });
    expect(filled.order.status).toBe("FILLED");
    const rejected = await adapter.placeOrder(owner, {
      symbol: "AAPL",
      side: "SELL",
      quantity: 50,
    });
    expect(rejected.order.status).toBe("REJECTED");
    expect(rejected.order.rejectionReason).toBe("INSUFFICIENT_POSITION");
    const account = await adapter.getAccount(owner);
    expect(account?.orders).toHaveLength(2);
    expect(replayLedger(account!.startingCash, account!.orders).cash).toBeCloseTo(
      10_000 - 1000.5 - 1,
      2,
    );
  });

  it("serialises concurrent orders so cash is never overspent", async () => {
    const adapter = broker();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        adapter.placeOrder(owner, { symbol: "MSFT", side: "BUY", quantity: 20 }),
      ),
    );
    const filled = results.filter((result) => result.order.status === "FILLED").length;
    expect(filled).toBe(2); // 2 × ~$4,002 fits in $10,000; the third would not
    const account = await adapter.getAccount(owner);
    expect(replayLedger(account!.startingCash, account!.orders).cash).toBeGreaterThanOrEqual(0);
  });

  it("resets to cash only", async () => {
    const adapter = broker();
    await adapter.placeOrder(owner, { symbol: "AAPL", side: "BUY", quantity: 1 });
    const reset = await adapter.resetAccount(owner, "cash");
    expect(reset.orders).toHaveLength(0);
  });
});
