import { describe, expect, it } from "vitest";

import { buildCalibrationSamples, walkForwardEvaluate } from "@/lib/markets/calibration";
import { SCORE_BANDS, scoreBucketAnalysis } from "@/lib/markets/diagnostics";
import { buildFeatureRows } from "@/lib/markets/signal-engine";
import { generateSyntheticHistory } from "@/lib/markets/synthetic";
import { DEMO_SYMBOLS } from "@/lib/markets/universe";
import { rankedProbabilityScore } from "@/lib/sports/evaluation";

const samples = DEMO_SYMBOLS.flatMap((symbol) =>
  buildCalibrationSamples(
    symbol,
    buildFeatureRows(generateSyntheticHistory(symbol, "2026-06-30")),
    20,
  ),
);

describe("score bucket analysis", () => {
  const analysis = scoreBucketAnalysis(samples, 20);

  it("assigns every sample to exactly one published band", () => {
    expect(analysis.buckets.map((bucket) => bucket.key)).toEqual(SCORE_BANDS.map((b) => b.key));
    expect(analysis.buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(
      samples.length,
    );
    expect(analysis.buckets[0]!.label).toBe("≤ −0.25");
    expect(analysis.buckets[4]!.label).toBe("≥ +0.25");
  });

  it("reports hit rates with intervals", () => {
    for (const bucket of analysis.buckets.filter((entry) => entry.count > 0)) {
      expect(bucket.hitRateLower!).toBeLessThanOrEqual(bucket.hitRate!);
      expect(bucket.hitRateUpper!).toBeGreaterThanOrEqual(bucket.hitRate!);
    }
    expect(analysis.baseRate).toBeGreaterThan(0.3);
    expect(analysis.baseRate).toBeLessThan(0.7);
    expect(typeof analysis.monotonic).toBe("boolean");
  });
});

describe("walk-forward diagnostics", () => {
  const evaluation = walkForwardEvaluate(samples, { horizonDays: 20 });

  it("adds sampling intervals to reliability bins", () => {
    for (const bin of evaluation.reliability.filter((entry) => entry.count > 0)) {
      expect(bin.observedLower!).toBeLessThanOrEqual(bin.observedFrequency!);
      expect(bin.observedUpper!).toBeGreaterThanOrEqual(bin.observedFrequency!);
    }
  });

  it("breaks skill down by quarter", () => {
    expect(evaluation.timeline.length).toBeGreaterThan(4);
    expect(evaluation.timeline.reduce((total, period) => total + period.predictions, 0)).toBe(
      evaluation.predictions,
    );
    const periods = evaluation.timeline.map((period) => period.period);
    expect([...periods].sort()).toEqual(periods);
    expect(periods[0]).toMatch(/^\d{4}-Q[1-4]$/);
  });
});

describe("ranked probability score", () => {
  it("rewards probability placed near the result", () => {
    expect(rankedProbabilityScore({ home: 1, draw: 0, away: 0 }, "HOME")).toBe(0);
    expect(rankedProbabilityScore({ home: 1, draw: 0, away: 0 }, "AWAY")).toBe(1);
    expect(rankedProbabilityScore({ home: 1, draw: 0, away: 0 }, "DRAW")).toBe(0.5);
    const drawHeavy = rankedProbabilityScore({ home: 0.2, draw: 0.6, away: 0.2 }, "AWAY");
    const homeHeavy = rankedProbabilityScore({ home: 0.6, draw: 0.2, away: 0.2 }, "AWAY");
    expect(drawHeavy).toBeLessThan(homeHeavy);
  });
});
