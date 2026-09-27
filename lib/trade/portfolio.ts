import { businessDaysBetween } from "@/lib/clock";
import type { PriceBar } from "@/lib/markets/types";
import { maxDrawdown, round, stdDev, TRADING_DAYS_PER_YEAR } from "@/lib/quant/stats";
import { replayLedger } from "@/lib/trade/ledger";
import type {
  ClosedPosition,
  ExposureSlice,
  LedgerState,
  PaperAccountRecord,
  PortfolioHistoryPoint,
  PortfolioSummary,
  Position,
} from "@/lib/trade/types";

/**
 * Portfolio analytics derived from the order ledger plus market prices. Pure functions.
 */

export interface PriceSnapshot {
  price: number;
  previousClose: number;
  name?: string;
}

export function buildPositions(
  ledger: LedgerState,
  prices: ReadonlyMap<string, PriceSnapshot>,
  totalValue: number,
): Position[] {
  const positions: Position[] = [];
  for (const holding of ledger.holdings.values()) {
    const snapshot = prices.get(holding.symbol);
    const marketPrice = snapshot?.price ?? holding.averageCost;
    const marketValue = marketPrice * holding.quantity;
    const costBasis = holding.averageCost * holding.quantity;
    positions.push({
      symbol: holding.symbol,
      name: snapshot?.name ?? holding.symbol,
      quantity: holding.quantity,
      averageCost: round(holding.averageCost, 4),
      costBasis: round(costBasis, 2),
      marketPrice,
      marketValue: round(marketValue, 2),
      unrealizedPnl: round(marketValue - costBasis, 2),
      unrealizedPnlPercent: costBasis > 0 ? round(marketValue / costBasis - 1, 6) : 0,
      dayChangePercent:
        snapshot && snapshot.previousClose > 0
          ? round(snapshot.price / snapshot.previousClose - 1, 6)
          : 0,
      realizedPnl: holding.realizedPnl,
      weight: totalValue > 0 ? round(marketValue / totalValue, 6) : 0,
      openedAt: holding.openedAt,
    });
  }
  return positions.sort((a, b) => b.marketValue - a.marketValue);
}

export function buildClosedPositions(ledger: LedgerState): ClosedPosition[] {
  return [...ledger.closed.values()].sort((a, b) => b.closedAt.localeCompare(a.closedAt));
}

export function summarisePortfolio(
  account: PaperAccountRecord,
  ledger: LedgerState,
  prices: ReadonlyMap<string, PriceSnapshot>,
): { summary: PortfolioSummary; positions: Position[]; exposure: ExposureSlice[] } {
  let marketValue = 0;
  let previousMarketValue = 0;
  let investedCapital = 0;
  for (const holding of ledger.holdings.values()) {
    const snapshot = prices.get(holding.symbol);
    const price = snapshot?.price ?? holding.averageCost;
    marketValue += price * holding.quantity;
    previousMarketValue += (snapshot?.previousClose ?? price) * holding.quantity;
    investedCapital += holding.averageCost * holding.quantity;
  }
  const totalValue = ledger.cash + marketValue;
  const positions = buildPositions(ledger, prices, totalValue);

  const weights = positions.map((position) => position.weight);
  const largest = positions.reduce<Position | null>(
    (best, position) => (best === null || position.weight > best.weight ? position : best),
    null,
  );
  const unrealizedPnl = marketValue - investedCapital;
  const dayChange = marketValue - previousMarketValue;
  const previousTotal = totalValue - dayChange;

  const exposure: ExposureSlice[] = positions.map((position) => ({
    symbol: position.symbol,
    label: position.symbol,
    marketValue: position.marketValue,
    weight: position.weight,
  }));
  exposure.push({
    symbol: "CASH",
    label: "Cash",
    marketValue: round(ledger.cash, 2),
    weight: totalValue > 0 ? round(ledger.cash / totalValue, 6) : 1,
  });

  return {
    positions,
    exposure,
    summary: {
      startingCash: account.startingCash,
      cash: round(ledger.cash, 2),
      marketValue: round(marketValue, 2),
      totalValue: round(totalValue, 2),
      investedCapital: round(investedCapital, 2),
      unrealizedPnl: round(unrealizedPnl, 2),
      unrealizedReturn: investedCapital > 0 ? round(unrealizedPnl / investedCapital, 6) : 0,
      realizedPnl: round(ledger.realizedPnl, 2),
      totalPnl: round(totalValue - account.startingCash, 2),
      totalReturn: round(totalValue / account.startingCash - 1, 6),
      feesPaid: ledger.feesPaid,
      dayChange: round(dayChange, 2),
      dayChangePercent: previousTotal > 0 ? round(dayChange / previousTotal, 6) : 0,
      cashWeight: totalValue > 0 ? round(ledger.cash / totalValue, 6) : 1,
      grossExposure: totalValue > 0 ? round(marketValue / totalValue, 6) : 0,
      largestPosition: largest ? { symbol: largest.symbol, weight: largest.weight } : null,
      herfindahlIndex: round(
        weights.reduce((total, weight) => total + weight * weight, 0),
        6,
      ),
    },
  };
}

/**
 * Daily portfolio value history reconstructed from the ledger and daily closes — the
 * "simulated history" used for drawdown and the equity chart.
 */
export function buildPortfolioHistory(
  account: PaperAccountRecord,
  barsBySymbol: ReadonlyMap<string, readonly PriceBar[]>,
  options: { from: string; to: string },
): PortfolioHistoryPoint[] {
  const closeLookup = new Map<string, Map<string, number>>();
  for (const [symbol, bars] of barsBySymbol) {
    closeLookup.set(symbol, new Map(bars.map((bar) => [bar.date, bar.close])));
  }
  const lastClose = new Map<string, number>();
  const orders = [...account.orders].sort((a, b) =>
    (a.filledAt ?? a.requestedAt).localeCompare(b.filledAt ?? b.requestedAt),
  );

  const points: PortfolioHistoryPoint[] = [];
  let peak = Number.NEGATIVE_INFINITY;
  let applied = 0;
  let state = replayLedger(account.startingCash, []);
  for (const date of businessDaysBetween(options.from, options.to)) {
    // Apply orders executed up to this date (inclusive).
    while (applied < orders.length) {
      const order = orders[applied];
      if (!order || (order.filledAt ?? order.requestedAt).slice(0, 10) > date) break;
      applied += 1;
      state = replayLedger(account.startingCash, orders.slice(0, applied));
    }
    for (const [symbol, closes] of closeLookup) {
      const close = closes.get(date);
      if (close !== undefined) lastClose.set(symbol, close);
    }
    let holdingsValue = 0;
    for (const holding of state.holdings.values()) {
      holdingsValue += (lastClose.get(holding.symbol) ?? holding.averageCost) * holding.quantity;
    }
    const value = state.cash + holdingsValue;
    peak = Math.max(peak, value);
    points.push({
      date,
      value: round(value, 2),
      cash: round(state.cash, 2),
      drawdown: peak > 0 ? round(value / peak - 1, 6) : 0,
    });
  }
  return points;
}

/**
 * Ex-ante annualised volatility of the CURRENT holdings (cash has zero volatility), using a
 * trailing window of daily returns: σ_p = stdev(Σ w_i · r_i,t) × √252.
 */
export function estimatePortfolioVolatility(
  positions: readonly Position[],
  totalValue: number,
  barsBySymbol: ReadonlyMap<string, readonly PriceBar[]>,
  window = 60,
): number {
  if (totalValue <= 0 || positions.length === 0) return 0;
  const returnsBySymbol = new Map<string, number[]>();
  for (const position of positions) {
    const bars = barsBySymbol.get(position.symbol) ?? [];
    const closes = bars.slice(-(window + 1)).map((bar) => bar.close);
    returnsBySymbol.set(
      position.symbol,
      closes.slice(1).map((close, i) => close / (closes[i] as number) - 1),
    );
  }
  const length = Math.min(...[...returnsBySymbol.values()].map((series) => series.length));
  if (!Number.isFinite(length) || length < 2) return 0;
  const portfolioReturns: number[] = [];
  for (let t = 0; t < length; t++) {
    let total = 0;
    for (const position of positions) {
      const series = returnsBySymbol.get(position.symbol) as number[];
      const value = series[series.length - length + t] as number;
      total += (position.marketValue / totalValue) * value;
    }
    portfolioReturns.push(total);
  }
  return round(stdDev(portfolioReturns) * Math.sqrt(TRADING_DAYS_PER_YEAR), 6);
}

export function historyMaxDrawdown(history: readonly PortfolioHistoryPoint[]): number {
  return round(maxDrawdown(history.map((point) => point.value)), 6);
}
