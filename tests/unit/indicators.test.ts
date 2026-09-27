import { describe, expect, it } from "vitest";

import {
  drawdownSeries,
  ema,
  macd,
  rateOfChange,
  rollingPercentileRank,
  rollingVolatility,
  rsi,
  simpleReturns,
  sma,
  trendStrength,
} from "@/lib/markets/indicators";
import { makeBars } from "@/tests/helpers/bars";

const closes = makeBars(300).map((bar) => bar.close);

describe("moving averages", () => {
  it("computes SMA with warm-up nulls", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("seeds EMA with the SMA and applies α = 2/(n+1)", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[2]).toBeCloseTo(2);
    expect(out[3]).toBeCloseTo(0.5 * 4 + 0.5 * 2);
    expect(out[4]).toBeCloseTo(0.5 * 5 + 0.5 * 3);
  });

  it("rejects invalid periods", () => {
    expect(() => sma([1, 2], 0)).toThrow();
    expect(() => ema([1, 2], 0)).toThrow();
  });
});

describe("RSI (Wilder)", () => {
  it("is 100 for a strictly rising series and 50 for a flat one", () => {
    const rising = Array.from({ length: 40 }, (_, i) => i + 1);
    expect(rsi(rising).at(-1)).toBe(100);
    expect(rsi(Array(40).fill(10)).at(-1)).toBe(50);
  });

  it("is first defined at index = period and bounded in [0, 100]", () => {
    const values = rsi(closes, 14);
    expect(values[13]).toBeNull();
    expect(values[14]).not.toBeNull();
    for (const value of values) if (value !== null) expect(value).toBeGreaterThanOrEqual(0);
    for (const value of values) if (value !== null) expect(value).toBeLessThanOrEqual(100);
  });

  it("matches a hand-computed Wilder value", () => {
    // 14 changes of +1 and −1 alternating → avg gain 0.5, avg loss 0.5 → RSI 50; next +2.
    const series = [10];
    for (let i = 0; i < 14; i++) series.push(series[i]! + (i % 2 === 0 ? 1 : -1));
    series.push(series.at(-1)! + 2);
    const value = rsi(series, 14).at(-1)!;
    const gain = (0.5 * 13 + 2) / 14;
    const loss = (0.5 * 13) / 14;
    expect(value).toBeCloseTo(100 - 100 / (1 + gain / loss), 10);
  });
});

describe("other indicators", () => {
  it("MACD histogram equals line minus signal", () => {
    const { macd: line, signal, histogram } = macd(closes);
    histogram.forEach((value, i) => {
      if (value !== null)
        expect(value).toBeCloseTo((line[i] as number) - (signal[i] as number), 12);
    });
  });

  it("returns, momentum and drawdown behave as defined", () => {
    expect(simpleReturns([100, 110, 99])).toEqual([
      null,
      expect.closeTo(0.1),
      expect.closeTo(-0.1),
    ]);
    expect(rateOfChange([100, 105, 120], 2)[2]).toBeCloseTo(0.2);
    expect(drawdownSeries([1, 2, 1, 3])).toEqual([0, 0, -0.5, 0]);
  });

  it("volatility is zero for constant growth and positive for noise", () => {
    const growth = Array.from({ length: 80 }, (_, i) => 100 * 1.001 ** i);
    expect(rollingVolatility(growth, 20)[20]).toBeCloseTo(0, 9);
    expect(rollingVolatility(closes, 20).at(-1)).toBeGreaterThan(0);
  });

  it("trend strength follows the direction of the trend", () => {
    const up = Array.from(
      { length: 120 },
      (_, i) => 100 * Math.exp(0.002 * i + 0.003 * Math.sin(i)),
    );
    expect(trendStrength(up).at(-1)).toBeGreaterThan(0.5);
    expect(trendStrength([...up].reverse()).at(-1)).toBeLessThan(-0.5);
  });

  it("percentile rank needs a minimum sample", () => {
    const ranks = rollingPercentileRank(
      Array.from({ length: 100 }, (_, i) => i),
      252,
      60,
    );
    expect(ranks[58]).toBeNull();
    expect(ranks[99]).toBeCloseTo(99.5 / 100);
  });
});

describe("causality (no look-ahead)", () => {
  const indicators: [string, (c: number[]) => (number | null)[]][] = [
    ["sma", (c) => sma(c, 20)],
    ["ema", (c) => ema(c, 20)],
    ["rsi", (c) => rsi(c, 14)],
    ["macd", (c) => macd(c).histogram],
    ["momentum", (c) => rateOfChange(c, 21)],
    ["volatility", (c) => rollingVolatility(c, 20)],
    ["trend", (c) => trendStrength(c, 50)],
  ];
  it.each(indicators)("%s is unchanged by appending future bars", (_, indicator) => {
    const full = indicator(closes);
    for (const cut of [80, 150, 220]) {
      expect(indicator(closes.slice(0, cut))).toEqual(full.slice(0, cut));
    }
  });
});
