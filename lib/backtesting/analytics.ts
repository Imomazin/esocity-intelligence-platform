import type { BacktestResult, EquityPoint } from "@/lib/backtesting/engine";
import { mean, round, stdDev, TRADING_DAYS_PER_YEAR } from "@/lib/quant/stats";

/**
 * Deeper performance analytics derived from a finished backtest's equity curve and trades.
 * Pure post-processing: nothing here can influence the simulation itself.
 */

export interface PeriodReturn {
  period: string;
  year: number;
  /** 1–12 for months; 0 for whole years. */
  month: number;
  strategy: number;
  benchmark: number;
}

export interface RollingPoint {
  date: string;
  strategy: number | null;
  benchmark: number | null;
}

export interface BacktestAnalytics {
  monthly: PeriodReturn[];
  yearly: PeriodReturn[];
  sortino: number;
  benchmarkSortino: number;
  calmar: number | null;
  profitFactor: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  bestMonth: PeriodReturn | null;
  worstMonth: PeriodReturn | null;
  positiveMonthShare: number | null;
  /** Longest run of sessions below the previous equity peak. */
  longestDrawdownSessions: number;
  /** Average strategy month ÷ average benchmark month, in up and down benchmark months. */
  upCapture: number | null;
  downCapture: number | null;
  /** Rolling six-month Sharpe-like ratio (zero risk-free rate). */
  rollingSharpe: RollingPoint[];
  rollingWindow: number;
}

export const ROLLING_WINDOW = 126;

function sortinoRatio(returns: readonly number[]): number {
  if (returns.length < 2) return 0;
  const downside = Math.sqrt(mean(returns.map((r) => Math.min(r, 0) ** 2)));
  if (!(downside > 0)) return 0;
  return (mean(returns) / downside) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

function periodReturns(
  curve: readonly EquityPoint[],
  initial: number,
  keyOf: (date: string) => string,
): PeriodReturn[] {
  const periods: PeriodReturn[] = [];
  let strategyBase = initial;
  let benchmarkBase = initial;
  for (let i = 0; i < curve.length; i++) {
    const point = curve[i] as EquityPoint;
    const next = curve[i + 1];
    if (next && keyOf(next.date) === keyOf(point.date)) continue;
    const key = keyOf(point.date);
    periods.push({
      period: key,
      year: Number(point.date.slice(0, 4)),
      month: key.length > 4 ? Number(point.date.slice(5, 7)) : 0,
      strategy: round(point.equity / strategyBase - 1, 6),
      benchmark: round(point.benchmark / benchmarkBase - 1, 6),
    });
    strategyBase = point.equity;
    benchmarkBase = point.benchmark;
  }
  return periods;
}

function rollingSharpe(
  strategy: readonly number[],
  benchmark: readonly number[],
  curve: readonly EquityPoint[],
  window: number,
): RollingPoint[] {
  const ratio = (slice: readonly number[]) => {
    const sd = stdDev(slice);
    return Number.isFinite(sd) && sd > 0
      ? round((mean(slice) / sd) * Math.sqrt(TRADING_DAYS_PER_YEAR), 3)
      : null;
  };
  return curve.map((point, i) => {
    if (i + 1 < window) return { date: point.date, strategy: null, benchmark: null };
    return {
      date: point.date,
      strategy: ratio(strategy.slice(i + 1 - window, i + 1)),
      benchmark: ratio(benchmark.slice(i + 1 - window, i + 1)),
    };
  });
}

function capture(periods: readonly PeriodReturn[], up: boolean): number | null {
  const selected = periods.filter((period) => (up ? period.benchmark > 0 : period.benchmark < 0));
  if (selected.length < 3) return null;
  const benchmark = mean(selected.map((period) => period.benchmark));
  if (benchmark === 0) return null;
  return round(mean(selected.map((period) => period.strategy)) / benchmark, 3);
}

export function analyseBacktest(result: BacktestResult): BacktestAnalytics {
  const curve = result.equityCurve;
  const initial = result.config.initialCapital;
  const equities = [initial, ...curve.map((point) => point.equity)];
  const benchmarks = [initial, ...curve.map((point) => point.benchmark)];
  const strategyReturns = equities.slice(1).map((value, i) => value / (equities[i] as number) - 1);
  const benchmarkReturns = benchmarks
    .slice(1)
    .map((value, i) => value / (benchmarks[i] as number) - 1);

  const monthly = periodReturns(curve, initial, (date) => date.slice(0, 7));
  const yearly = periodReturns(curve, initial, (date) => date.slice(0, 4));
  const bySize = [...monthly].sort((a, b) => a.strategy - b.strategy);

  const pnls = result.trades.map((trade) => trade.pnl);
  const grossProfit = pnls.filter((pnl) => pnl > 0).reduce((total, pnl) => total + pnl, 0);
  const grossLoss = -pnls.filter((pnl) => pnl < 0).reduce((total, pnl) => total + pnl, 0);
  const wins = result.trades.filter((trade) => trade.returnPct > 0).map((trade) => trade.returnPct);
  const losses = result.trades
    .filter((trade) => trade.returnPct <= 0)
    .map((trade) => trade.returnPct);

  let longest = 0;
  let run = 0;
  for (const point of curve) {
    run = point.drawdown < 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  const { cagr, maxDrawdown } = result.metrics;
  return {
    monthly,
    yearly,
    sortino: round(sortinoRatio(strategyReturns), 3),
    benchmarkSortino: round(sortinoRatio(benchmarkReturns), 3),
    calmar: maxDrawdown < 0 ? round(cagr / Math.abs(maxDrawdown), 3) : null,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 3) : null,
    averageWin: wins.length > 0 ? round(mean(wins), 6) : null,
    averageLoss: losses.length > 0 ? round(mean(losses), 6) : null,
    bestMonth: bySize[bySize.length - 1] ?? null,
    worstMonth: bySize[0] ?? null,
    positiveMonthShare:
      monthly.length > 0
        ? round(monthly.filter((period) => period.strategy > 0).length / monthly.length, 4)
        : null,
    longestDrawdownSessions: longest,
    upCapture: capture(monthly, true),
    downCapture: capture(monthly, false),
    rollingSharpe: rollingSharpe(strategyReturns, benchmarkReturns, curve, ROLLING_WINDOW),
    rollingWindow: ROLLING_WINDOW,
  };
}
