import { describe, expect, it } from "vitest";

import { analyseBacktest, ROLLING_WINDOW } from "@/lib/backtesting/analytics";
import { runBacktest } from "@/lib/backtesting/engine";
import { generateSyntheticHistory } from "@/lib/markets/synthetic";

const bars = generateSyntheticHistory("NVDA", "2026-06-30");
const result = runBacktest(bars, {
  symbol: "NVDA",
  strategy: "composite",
  startDate: "2024-06-28",
  endDate: "2026-06-30",
  initialCapital: 100_000,
  feeBps: 5,
  slippageBps: 5,
});
const analytics = analyseBacktest(result);

const compound = (values: number[]) => values.reduce((total, value) => total * (1 + value), 1) - 1;

describe("backtest analytics", () => {
  it("chains monthly and yearly returns back to the total return", () => {
    expect(compound(analytics.monthly.map((period) => period.strategy))).toBeCloseTo(
      result.metrics.totalReturn,
      4,
    );
    expect(compound(analytics.monthly.map((period) => period.benchmark))).toBeCloseTo(
      result.metrics.benchmarkReturn,
      4,
    );
    expect(compound(analytics.yearly.map((period) => period.strategy))).toBeCloseTo(
      result.metrics.totalReturn,
      4,
    );
    expect(analytics.monthly[0]!.period).toBe("2024-06");
    expect(analytics.yearly.map((period) => period.month)).toEqual(analytics.yearly.map(() => 0));
  });

  it("reports risk-adjusted statistics consistently", () => {
    expect(analytics.bestMonth!.strategy).toBeGreaterThanOrEqual(analytics.worstMonth!.strategy);
    expect(analytics.positiveMonthShare).toBeGreaterThan(0);
    expect(analytics.longestDrawdownSessions).toBeGreaterThan(0);
    if (result.metrics.maxDrawdown < 0) {
      expect(analytics.calmar).toBeCloseTo(
        result.metrics.cagr / Math.abs(result.metrics.maxDrawdown),
        2,
      );
    }
    expect(Math.sign(analytics.sortino)).toBe(Math.sign(result.metrics.sharpe));
  });

  it("computes a rolling six-month Sharpe aligned with the curve", () => {
    expect(analytics.rollingSharpe).toHaveLength(result.equityCurve.length);
    expect(analytics.rollingSharpe[ROLLING_WINDOW - 2]!.strategy).toBeNull();
    expect(analytics.rollingSharpe.at(-1)!.benchmark).not.toBeNull();
  });
});
