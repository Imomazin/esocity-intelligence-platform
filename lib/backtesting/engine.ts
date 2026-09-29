import { STRATEGIES, type StrategyId } from "@/lib/backtesting/strategies";
import type { PriceBar } from "@/lib/markets/types";
import { mean, round, sharpeLikeRatio, stdDev, TRADING_DAYS_PER_YEAR } from "@/lib/quant/stats";

/**
 * Event-driven daily backtester (long/flat, single asset, no leverage).
 *
 * Chronology per bar t (the no-look-ahead contract):
 *   1. At the OPEN of bar t, execute the target decided at the CLOSE of bar t−1.
 *   2. Mark the portfolio to market at the CLOSE of bar t.
 *   3. The strategy's decision for bar t (using bars[0..t] only) is executed at bar t+1's open.
 * Bars after `endDate` are removed before any computation, so they cannot influence results.
 */

export interface BacktestConfig {
  symbol: string;
  strategy: StrategyId;
  startDate: string;
  endDate: string;
  initialCapital: number;
  /** Commission in basis points of traded notional. */
  feeBps: number;
  /** Adverse execution slippage in basis points. */
  slippageBps: number;
}

export const DEFAULT_BACKTEST_COSTS = {
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 5,
} as const;

export interface BacktestTrade {
  signalDate: string;
  entryDate: string;
  entryPrice: number;
  exitSignalDate: string | null;
  exitDate: string | null;
  exitPrice: number | null;
  shares: number;
  pnl: number;
  returnPct: number;
  holdingDays: number;
  open: boolean;
}

export interface EquityPoint {
  date: string;
  equity: number;
  benchmark: number;
  drawdown: number;
  exposure: 0 | 1;
}

export interface BacktestMetrics {
  startingCapital: number;
  endingCapital: number;
  totalReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
  cagr: number;
  trades: number;
  winRate: number | null;
  averageTradeReturn: number | null;
  maxDrawdown: number;
  benchmarkMaxDrawdown: number;
  volatility: number;
  sharpe: number;
  benchmarkSharpe: number;
  exposure: number;
  feesPaid: number;
  tradingDays: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  strategyName: string;
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  trades: BacktestTrade[];
  assumptions: string[];
  warnings: string[];
}

export class BacktestInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestInputError";
  }
}

function maxDrawdownOf(values: readonly number[]): number {
  let peak = Number.NEGATIVE_INFINITY;
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

function dailyReturns(values: readonly number[]): number[] {
  return values.slice(1).map((value, i) => value / (values[i] as number) - 1);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function runBacktest(allBars: readonly PriceBar[], config: BacktestConfig): BacktestResult {
  const strategy = STRATEGIES[config.strategy];
  if (!strategy) throw new BacktestInputError(`Unknown strategy "${config.strategy}"`);
  if (config.startDate >= config.endDate) {
    throw new BacktestInputError("Start date must be before end date.");
  }
  if (!(config.initialCapital > 0))
    throw new BacktestInputError("Initial capital must be positive.");
  if (config.feeBps < 0 || config.slippageBps < 0) {
    throw new BacktestInputError("Costs cannot be negative.");
  }

  // Hard guard: nothing after endDate exists as far as this backtest is concerned.
  const bars = allBars.filter((bar) => bar.date <= config.endDate);
  const startIndex = bars.findIndex((bar) => bar.date >= config.startDate);
  const endIndex = bars.length - 1;
  if (startIndex < 0 || endIndex - startIndex < 20) {
    throw new BacktestInputError("Date range must contain at least 20 trading days of data.");
  }

  const warnings: string[] = [];
  if (startIndex < strategy.warmupBars) {
    warnings.push(
      `Only ${startIndex} bars of history precede the start date; the strategy needs ${strategy.warmupBars} to warm up and stays in cash until then.`,
    );
  }

  const targets = strategy.targets(bars);
  const feeRate = config.feeBps / 10_000;
  const slippage = config.slippageBps / 10_000;

  let cash = config.initialCapital;
  let shares = 0;
  let feesPaid = 0;
  let daysInMarket = 0;
  const trades: BacktestTrade[] = [];
  let openTrade: BacktestTrade | null = null;
  const equityCurve: EquityPoint[] = [];

  // Buy-and-hold benchmark: invest at the first open (same frictions), hold to the end.
  const firstBar = bars[startIndex] as PriceBar;
  const benchmarkEntry = firstBar.open * (1 + slippage);
  const benchmarkShares = Math.floor(config.initialCapital / (benchmarkEntry * (1 + feeRate)));
  const benchmarkCash =
    config.initialCapital -
    benchmarkShares * benchmarkEntry -
    benchmarkShares * benchmarkEntry * feeRate;

  let equityPeak = config.initialCapital;
  for (let t = startIndex; t <= endIndex; t++) {
    const bar = bars[t] as PriceBar;
    const signalBar = bars[t - 1];
    const desired = t > 0 ? (targets[t - 1] ?? 0) : 0;

    if (desired === 1 && shares === 0) {
      const price = bar.open * (1 + slippage);
      const quantity = Math.floor(cash / (price * (1 + feeRate)));
      if (quantity > 0) {
        const fee = quantity * price * feeRate;
        cash -= quantity * price + fee;
        feesPaid += fee;
        shares = quantity;
        openTrade = {
          signalDate: signalBar?.date ?? bar.date,
          entryDate: bar.date,
          entryPrice: round(price, 4),
          exitSignalDate: null,
          exitDate: null,
          exitPrice: null,
          shares: quantity,
          pnl: -fee,
          returnPct: 0,
          holdingDays: 0,
          open: true,
        };
      }
    } else if (desired === 0 && shares > 0 && openTrade) {
      const price = bar.open * (1 - slippage);
      const fee = shares * price * feeRate;
      cash += shares * price - fee;
      feesPaid += fee;
      const entryCost = openTrade.entryPrice * shares * (1 + feeRate);
      const exitProceeds = shares * price - fee;
      trades.push({
        ...openTrade,
        exitSignalDate: signalBar?.date ?? bar.date,
        exitDate: bar.date,
        exitPrice: round(price, 4),
        pnl: round(exitProceeds - entryCost, 2),
        returnPct: round(exitProceeds / entryCost - 1, 6),
        holdingDays: daysBetween(openTrade.entryDate, bar.date),
        open: false,
      });
      shares = 0;
      openTrade = null;
    }

    const equity = cash + shares * bar.close;
    equityPeak = Math.max(equityPeak, equity);
    if (shares > 0) daysInMarket += 1;
    equityCurve.push({
      date: bar.date,
      equity: round(equity, 2),
      benchmark: round(benchmarkCash + benchmarkShares * bar.close, 2),
      drawdown: round(equity / equityPeak - 1, 6),
      exposure: shares > 0 ? 1 : 0,
    });
  }

  const lastBar = bars[endIndex] as PriceBar;
  if (openTrade) {
    // Mark the open position to the final close for reporting (not closed in the ledger).
    const entryCost = openTrade.entryPrice * openTrade.shares * (1 + feeRate);
    const markValue = openTrade.shares * lastBar.close;
    trades.push({
      ...openTrade,
      pnl: round(markValue - entryCost, 2),
      returnPct: round(markValue / entryCost - 1, 6),
      holdingDays: daysBetween(openTrade.entryDate, lastBar.date),
      open: true,
    });
  }

  const equities = equityCurve.map((point) => point.equity);
  const benchmarks = equityCurve.map((point) => point.benchmark);
  const endingCapital = equities[equities.length - 1] ?? config.initialCapital;
  const benchmarkEnd = benchmarks[benchmarks.length - 1] ?? config.initialCapital;
  const strategyReturns = dailyReturns([config.initialCapital, ...equities]);
  const benchmarkReturns = dailyReturns([config.initialCapital, ...benchmarks]);
  const years = equityCurve.length / TRADING_DAYS_PER_YEAR;
  const totalReturn = endingCapital / config.initialCapital - 1;
  const benchmarkReturn = benchmarkEnd / config.initialCapital - 1;
  const wins = trades.filter((trade) => trade.pnl > 0).length;

  return {
    config,
    strategyName: strategy.name,
    equityCurve,
    trades,
    warnings,
    assumptions: [
      "Signals are computed at each day's close using only data available at that close.",
      "Orders execute at the next trading day's open — never on the signal bar.",
      `Commission of ${config.feeBps} bps and adverse slippage of ${config.slippageBps} bps on every fill.`,
      "Long/flat only: no leverage, no short selling, whole shares, idle cash earns nothing.",
      "Benchmark buys and holds the same asset from the first open with the same frictions.",
      "Past (simulated) performance does not predict future results.",
    ],
    metrics: {
      startingCapital: config.initialCapital,
      endingCapital: round(endingCapital, 2),
      totalReturn: round(totalReturn, 6),
      benchmarkReturn: round(benchmarkReturn, 6),
      excessReturn: round(totalReturn - benchmarkReturn, 6),
      cagr:
        years > 0 ? round(Math.pow(endingCapital / config.initialCapital, 1 / years) - 1, 6) : 0,
      trades: trades.length,
      winRate: trades.length ? round(wins / trades.length, 4) : null,
      averageTradeReturn: trades.length
        ? round(mean(trades.map((trade) => trade.returnPct)), 6)
        : null,
      maxDrawdown: round(maxDrawdownOf([config.initialCapital, ...equities]), 6),
      benchmarkMaxDrawdown: round(maxDrawdownOf([config.initialCapital, ...benchmarks]), 6),
      volatility: round(stdDev(strategyReturns) * Math.sqrt(TRADING_DAYS_PER_YEAR), 6),
      sharpe: round(sharpeLikeRatio(strategyReturns), 4),
      benchmarkSharpe: round(sharpeLikeRatio(benchmarkReturns), 4),
      exposure: equityCurve.length ? round(daysInMarket / equityCurve.length, 4) : 0,
      feesPaid: round(feesPaid, 2),
      tradingDays: equityCurve.length,
    },
  };
}
