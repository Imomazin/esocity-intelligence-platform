import { describe, expect, it } from "vitest";

import { generateSyntheticHistory } from "@/lib/markets/synthetic";
import { quantile } from "@/lib/quant/stats";
import { analysePortfolioRisk } from "@/lib/trade/risk-analytics";

const THROUGH = "2026-06-30";
const bars = new Map(
  ["AAPL", "TSLA", "SPY", "MSFT"].map((symbol) => [
    symbol,
    generateSyntheticHistory(symbol, THROUGH),
  ]),
);
const lastClose = (symbol: string) => bars.get(symbol)!.at(-1)!.close;

describe("portfolio risk analytics", () => {
  it("reproduces single-asset historical VaR", () => {
    const risk = analysePortfolioRisk({
      holdings: [{ symbol: "SPY", marketValue: 100_000 }],
      totalValue: 100_000,
      barsBySymbol: bars,
      benchmarkSymbol: "SPY",
    })!;
    const closes = bars
      .get("SPY")!
      .slice(-253)
      .map((bar) => bar.close);
    const returns = closes.slice(1).map((close, i) => close / closes[i]! - 1);
    const var95 = risk.valueAtRisk.find((entry) => entry.key === "95-1d")!;
    expect(var95.historical.fraction).toBeCloseTo(-quantile(returns, 0.05), 6);
    expect(var95.expectedShortfall.fraction).toBeGreaterThanOrEqual(var95.historical.fraction);
    expect(risk.contributions[0]!.riskShare).toBeCloseTo(1, 6);
    expect(risk.diversificationRatio).toBeCloseTo(1, 6);
    expect(risk.beta).toBeCloseTo(1, 6);
    const shock = risk.scenarios.find((scenario) => scenario.key === "market-10")!;
    expect(shock.portfolioReturn).toBeCloseTo(-0.1, 6);
    expect(shock.pnl).toBeCloseTo(-10_000, 0);
  });

  it("scales with the invested share and diversifies across holdings", () => {
    const half = analysePortfolioRisk({
      holdings: [{ symbol: "TSLA", marketValue: 50_000 }],
      totalValue: 100_000,
      barsBySymbol: bars,
    })!;
    const full = analysePortfolioRisk({
      holdings: [{ symbol: "TSLA", marketValue: 100_000 }],
      totalValue: 100_000,
      barsBySymbol: bars,
    })!;
    expect(half.valueAtRisk[0]!.historical.fraction).toBeCloseTo(
      full.valueAtRisk[0]!.historical.fraction / 2,
      6,
    );
    expect(half.benchmarkSymbol).toBeNull();

    const mixed = analysePortfolioRisk({
      holdings: [
        { symbol: "AAPL", marketValue: 30 * lastClose("AAPL") },
        { symbol: "TSLA", marketValue: 20 * lastClose("TSLA") },
        { symbol: "MSFT", marketValue: 25 * lastClose("MSFT") },
      ],
      totalValue: 30 * lastClose("AAPL") + 20 * lastClose("TSLA") + 25 * lastClose("MSFT") + 5_000,
      barsBySymbol: bars,
      benchmarkSymbol: "SPY",
    })!;
    expect(mixed.contributions.reduce((total, entry) => total + entry.riskShare, 0)).toBeCloseTo(
      1,
      3,
    );
    expect(mixed.diversificationRatio!).toBeGreaterThan(1);
    expect(mixed.lookbackDays).toBe(252);
    const ten = mixed.valueAtRisk.find((entry) => entry.key === "95-10d")!;
    const one = mixed.valueAtRisk.find((entry) => entry.key === "95-1d")!;
    expect(ten.historical.fraction).toBeGreaterThan(one.historical.fraction);
    expect(mixed.histogram.reduce((total, bin) => total + bin.count, 0)).toBe(252);
    expect(mixed.scenarios.map((scenario) => scenario.key)).toEqual([
      "market-10",
      "market-20",
      "worst-1",
      "worst-5",
      "worst-20",
      "benchmark-drawdown",
    ]);
    for (const scenario of mixed.scenarios.filter((entry) => entry.kind === "historical")) {
      expect(scenario.start! < scenario.end!).toBe(true);
    }
  });

  it("returns null without positions", () => {
    expect(
      analysePortfolioRisk({ holdings: [], totalValue: 100_000, barsBySymbol: bars }),
    ).toBeNull();
  });
});
