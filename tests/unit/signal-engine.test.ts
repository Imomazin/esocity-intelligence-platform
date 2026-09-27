import { describe, expect, it } from "vitest";

import { classifyRegime } from "@/lib/markets/regime";
import {
  buildCompositeSignal,
  buildFeatureRows,
  compositeScore,
  computeConfidence,
  decideSignal,
  scoreMomentum,
  scoreRsi,
  scoreTrend,
  scoreVolatility,
  SIGNAL_WEIGHTS,
} from "@/lib/markets/signal-engine";
import { makeBars } from "@/tests/helpers/bars";

describe("component scores", () => {
  it("stay within [−1, 1]", () => {
    for (let value = 0; value <= 100; value += 5) {
      expect(Math.abs(scoreRsi(value))).toBeLessThanOrEqual(1);
    }
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      expect(scoreVolatility(p)).toBeGreaterThanOrEqual(-1);
      expect(scoreVolatility(p)).toBeLessThanOrEqual(0.5);
    }
    expect(Math.abs(scoreTrend(110, 105, 100, 0.9))).toBeLessThanOrEqual(1);
    expect(Math.abs(scoreMomentum(0.4, 0.8, 0.2))).toBeLessThan(1);
  });

  it("RSI reverses beyond the 30/70 bands", () => {
    expect(scoreRsi(60)).toBeGreaterThan(0);
    expect(scoreRsi(90)).toBeLessThan(scoreRsi(70));
    expect(scoreRsi(10)).toBeGreaterThan(scoreRsi(30));
  });

  it("weights sum to 1", () => {
    expect(Object.values(SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe("decision rules", () => {
  it("applies the published thresholds", () => {
    expect(decideSignal(0.25)).toBe("BUY");
    expect(decideSignal(0.2499)).toBe("HOLD");
    expect(decideSignal(-0.25)).toBe("SELL");
  });

  it("classifies regimes in order", () => {
    const base = { close: 110, sma20: 105, sma50: 100, trendStrength: 0.5 };
    expect(classifyRegime({ ...base, volatilityPercentile: 0.95 })).toBe("HIGH_VOLATILITY");
    expect(classifyRegime({ ...base, volatilityPercentile: 0.5 })).toBe("UPTREND");
    expect(
      classifyRegime({
        close: 90,
        sma20: 95,
        sma50: 100,
        trendStrength: -0.5,
        volatilityPercentile: 0.5,
      }),
    ).toBe("DOWNTREND");
    expect(
      classifyRegime({
        close: 101,
        sma20: 99,
        sma50: 100,
        trendStrength: 0.05,
        volatilityPercentile: 0.5,
      }),
    ).toBe("RANGE_BOUND");
  });

  it("bounds confidence and never gives HOLD top-tier conviction", () => {
    const scores = { trend: 0.8, momentum: 0.6, rsi: 0.2, volatility: 0.1, regime: 0.8 };
    const score = compositeScore(scores);
    const confidence = computeConfidence(score, decideSignal(score), scores, "UPTREND");
    expect(confidence).toBeGreaterThanOrEqual(0.05);
    expect(confidence).toBeLessThanOrEqual(0.95);
    const zero = { trend: 0, momentum: 0, rsi: 0, volatility: 0, regime: 0 };
    expect(computeConfidence(0, "HOLD", zero, "RANGE_BOUND")).toBeLessThanOrEqual(0.8);
  });
});

describe("feature rows and explainable signal", () => {
  const bars = makeBars(320);
  const rows = buildFeatureRows(bars);

  it("warms up before scoring", () => {
    expect(rows[50]?.composite).toBeNull();
    expect(rows.at(-1)?.composite).not.toBeNull();
  });

  it("builds a signal whose components reconcile with the score", () => {
    const signal = buildCompositeSignal(rows.at(-1)!, { symbol: "TEST", probabilityUp: 0.56 });
    const total = signal.components.reduce((sum, component) => sum + component.contribution, 0);
    expect(total).toBeCloseTo(signal.score, 3);
    expect(signal.explanation).toContain("TEST");
    expect(signal.expectedDirection).toBe("UP");
  });

  it("refuses to signal without enough history", () => {
    expect(() => buildCompositeSignal(rows[10]!, { symbol: "TEST", probabilityUp: 0.5 })).toThrow(
      /Insufficient/,
    );
  });
});
