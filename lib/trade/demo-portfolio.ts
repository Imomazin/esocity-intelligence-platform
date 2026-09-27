import { businessDaysBetween, previousBusinessDay } from "@/lib/clock";
import type { PriceBar } from "@/lib/markets/types";
import { hashString } from "@/lib/quant/random";
import { replayLedger } from "@/lib/trade/ledger";
import { validateOrder } from "@/lib/trade/order-validation";
import type { OrderSide, PaperAccountRecord, PaperOrder } from "@/lib/trade/types";

export const DEMO_STARTING_CASH = 100_000;
export const DEMO_ACCOUNT_NAME = "Demo paper portfolio";

/** Deterministic RFC-4122-shaped (v4 layout) id derived from a seed string. */
export function deterministicUuid(seed: string): string {
  const hex = [0, 1, 2, 3].map((i) => hashString(seed, i).toString(16).padStart(8, "0")).join("");
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

interface PlannedOrder {
  /** Business days before the last completed trading day. */
  offset: number;
  symbol: string;
  side: OrderSide;
  quantity: number;
  /** Minutes after 13:30 UTC. */
  minute: number;
}

/**
 * A plausible trading history: diversified entries, a partial profit-take, a closed position,
 * and one order that is deliberately REJECTED (selling more than held) so the order history
 * demonstrates the validation rules.
 */
const DEMO_PLAN: PlannedOrder[] = [
  { offset: 126, symbol: "SPY", side: "BUY", quantity: 40, minute: 12 },
  { offset: 126, symbol: "MSFT", side: "BUY", quantity: 30, minute: 25 },
  { offset: 119, symbol: "AAPL", side: "BUY", quantity: 50, minute: 41 },
  { offset: 111, symbol: "NVDA", side: "BUY", quantity: 200, minute: 64 },
  { offset: 97, symbol: "AMZN", side: "BUY", quantity: 40, minute: 95 },
  { offset: 82, symbol: "META", side: "BUY", quantity: 16, minute: 130 },
  { offset: 61, symbol: "NVDA", side: "SELL", quantity: 80, minute: 172 },
  { offset: 45, symbol: "GOOGL", side: "BUY", quantity: 35, minute: 205 },
  { offset: 31, symbol: "TSLA", side: "BUY", quantity: 10, minute: 233 },
  { offset: 22, symbol: "AMZN", side: "SELL", quantity: 15, minute: 262 },
  { offset: 10, symbol: "TSLA", side: "SELL", quantity: 10, minute: 301 },
  { offset: 4, symbol: "MSFT", side: "SELL", quantity: 50, minute: 338 },
];

function timestampFor(date: string, minute: number): string {
  const base = new Date(`${date}T13:30:00Z`).getTime();
  return new Date(base + minute * 60_000).toISOString();
}

export interface DemoAccountInput {
  accountId: string;
  ownerId: string;
  /** Last completed trading date (YYYY-MM-DD). */
  lastCompletedDate: string;
  barsBySymbol: ReadonlyMap<string, readonly PriceBar[]>;
  mode?: "demo" | "cash";
  createdAt?: string;
}

/**
 * Build the seeded demo account. Every seeded order passes through the same `validateOrder`
 * rules as live paper orders, so the history is internally consistent by construction.
 */
export function buildDemoAccount(input: DemoAccountInput): PaperAccountRecord {
  const { accountId, ownerId, lastCompletedDate, barsBySymbol } = input;
  const lookback = businessDaysBetween("2022-01-03", lastCompletedDate);
  const dateAt = (offset: number) => lookback[Math.max(0, lookback.length - 1 - offset)] as string;
  const firstDate = dateAt(DEMO_PLAN[0]?.offset ?? 0);
  const fundedAt = timestampFor(previousBusinessDay(firstDate), 0);

  const record: PaperAccountRecord = {
    id: accountId,
    ownerId,
    name: DEMO_ACCOUNT_NAME,
    baseCurrency: "USD",
    startingCash: DEMO_STARTING_CASH,
    createdAt: input.createdAt ?? fundedAt,
    updatedAt: input.createdAt ?? fundedAt,
    orders: [],
  };
  if (input.mode === "cash") return record;

  const knownSymbols = new Set(barsBySymbol.keys());
  DEMO_PLAN.forEach((plan, index) => {
    const date = dateAt(plan.offset);
    const bar = barsBySymbol.get(plan.symbol)?.find((candidate) => candidate.date === date);
    if (!bar) return;
    const ledger = replayLedger(record.startingCash, record.orders);
    let holdingsValue = 0;
    for (const holding of ledger.holdings.values()) {
      const close = barsBySymbol
        .get(holding.symbol)
        ?.find((candidate) => candidate.date === date)?.close;
      holdingsValue += (close ?? holding.averageCost) * holding.quantity;
    }
    const held = ledger.holdings.get(plan.symbol);
    const validation = validateOrder(
      { symbol: plan.symbol, side: plan.side, quantity: plan.quantity },
      {
        ledger,
        knownSymbols,
        referencePrice: bar.close,
        holdingsMarketValue: holdingsValue,
        symbolMarketValue: (held?.quantity ?? 0) * bar.close,
        existingOrderCount: record.orders.length,
      },
    );
    const at = timestampFor(date, plan.minute);
    const base = {
      id: deterministicUuid(`${accountId}:seed:${index}`),
      accountId,
      symbol: plan.symbol,
      side: plan.side,
      type: "MARKET" as const,
      quantity: plan.quantity,
      requestedAt: at,
      source: "seed" as const,
      clientOrderId: `seed-${index + 1}`,
    };
    const order: PaperOrder = validation.ok
      ? {
          ...base,
          status: "FILLED",
          filledAt: at,
          referencePrice: bar.close,
          fillPrice: validation.estimate.fillPrice,
          fee: validation.estimate.fee,
          notional: validation.estimate.notional,
          cashImpact: validation.estimate.cashImpact,
          realizedPnl: null,
          rejectionReason: null,
          rejectionMessage: null,
        }
      : {
          ...base,
          status: "REJECTED",
          filledAt: null,
          referencePrice: bar.close,
          fillPrice: null,
          fee: 0,
          notional: null,
          cashImpact: 0,
          realizedPnl: null,
          rejectionReason: validation.reason,
          rejectionMessage: validation.message,
        };
    record.orders.push(order);
  });
  return record;
}
