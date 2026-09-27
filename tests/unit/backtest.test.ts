import { describe, expect, it } from "vitest";

import { BacktestInputError, runBacktest, type BacktestConfig } from "@/lib/backtesting/engine";
import { STRATEGY_IDS } from "@/lib/backtesting/strategies";
import { makeBars } from "@/tests/helpers/bars";

const bars = makeBars(420);

function config(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    symbol: "TEST",
    strategy: "sma_crossover",
    startDate: bars[120]!.date,
    endDate: bars.at(-1)!.date,
    initialCapital: 100_000,
    feeBps: 5,
    slippageBps: 5,
    ...overrides,
  };
}

describe("backtest chronology", () => {
  it.each(STRATEGY_IDS)(
    "%s: results are invariant to bars after the end date (no leakage)",
    (strategy) => {
      const endDate = bars[320]!.date;
      const truncated = runBacktest(bars.slice(0, 321), config({ strategy, endDate }));
      const full = runBacktest(bars, config({ strategy, endDate }));
      expect(full).toEqual(truncated);
    },
  );

  it("executes at the open of the bar after the signal", () => {
    const result = runBacktest(bars, config());
    expect(result.trades.length).toBeGreaterThan(0);
    for (const trade of result.trades) {
      expect(trade.entryDate > trade.signalDate).toBe(true);
      const entryBar = bars.find((bar) => bar.date === trade.entryDate)!;
      expect(trade.entryPrice).toBeCloseTo(entryBar.open * 1.0005, 3);
      if (trade.exitDate) expect(trade.exitDate > trade.exitSignalDate!).toBe(true);
    }
  });

  it("changing a future price does not change earlier equity", () => {
    const shocked = bars.map((bar, i) =>
      i === 400 ? { ...bar, close: bar.close * 2, high: bar.high * 2 } : bar,
    );
    const a = runBacktest(bars, config()).equityCurve.slice(0, 250);
    const b = runBacktest(shocked, config()).equityCurve.slice(0, 250);
    expect(b).toEqual(a);
  });
});

describe("backtest accounting", () => {
  it("costs reduce performance and metrics are consistent", () => {
    const free = runBacktest(bars, config({ feeBps: 0, slippageBps: 0 }));
    const costly = runBacktest(bars, config({ feeBps: 50, slippageBps: 50 }));
    expect(costly.metrics.endingCapital).toBeLessThan(free.metrics.endingCapital);
    expect(free.metrics.feesPaid).toBe(0);
    expect(costly.metrics.tradingDays).toBe(costly.equityCurve.length);
    expect(costly.metrics.maxDrawdown).toBeLessThanOrEqual(0);
    expect(costly.metrics.exposure).toBeGreaterThanOrEqual(0);
    expect(costly.metrics.exposure).toBeLessThanOrEqual(1);
  });

  it("warns when history is too short to warm up", () => {
    const result = runBacktest(bars, config({ strategy: "composite", startDate: bars[30]!.date }));
    expect(result.warnings.length).toBe(1);
  });

  it("rejects invalid configurations", () => {
    expect(() =>
      runBacktest(bars, config({ startDate: bars[300]!.date, endDate: bars[100]!.date })),
    ).toThrow(BacktestInputError);
    expect(() => runBacktest(bars, config({ startDate: bars.at(-5)!.date }))).toThrow(
      BacktestInputError,
    );
    expect(() => runBacktest(bars, config({ initialCapital: 0 }))).toThrow(BacktestInputError);
    expect(() => runBacktest(bars, config({ feeBps: -1 }))).toThrow(BacktestInputError);
  });
});
