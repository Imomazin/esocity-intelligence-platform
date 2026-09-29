import { describe, expect, it } from "vitest";

import { NYSE_CALENDAR } from "@/lib/markets/calendar";
import { buildCalibrationSamples } from "@/lib/markets/calibration";
import {
  buildForecastSamples,
  fitForecastShape,
  forecastAsset,
  horizonVariance,
  MIN_SHAPE_SAMPLES,
  volatilityStates,
  walkForwardForecastEvaluation,
  type ForecastSample,
} from "@/lib/markets/forecast";
import { buildFeatureRows, SIGNAL_HORIZON_DAYS } from "@/lib/markets/signal-engine";
import { generateSyntheticHistory } from "@/lib/markets/synthetic";
import { DEMO_SYMBOLS } from "@/lib/markets/universe";

const THROUGH = "2026-06-30";
const H = SIGNAL_HORIZON_DAYS;

function universe() {
  return DEMO_SYMBOLS.map((symbol) => {
    const bars = generateSyntheticHistory(symbol, THROUGH);
    const states = volatilityStates(bars);
    return {
      symbol,
      bars,
      states,
      forecastSamples: buildForecastSamples(symbol, bars, states, H),
      calibrationSamples: buildCalibrationSamples(symbol, buildFeatureRows(bars), H),
    };
  });
}

const assets = universe();
const pooled: ForecastSample[] = assets.flatMap((asset) => asset.forecastSamples);

describe("volatility term structure", () => {
  it("is causal", () => {
    const full = assets[0]!.bars;
    const cut = full.slice(0, 400);
    expect(volatilityStates(cut)).toEqual(volatilityStates(full).slice(0, 400));
  });

  it("mean-reverts from the current level toward the long-run level", () => {
    const calm = { ewma: 0.0001, longRun: 0.0001 };
    expect(horizonVariance(calm, 20)).toBeCloseTo(0.002, 12);
    const stressed = { ewma: 0.0009, longRun: 0.0001 };
    // Per-day variance falls with the horizon but stays above the long-run level.
    const perDay = [1, 5, 20, 60].map((h) => horizonVariance(stressed, h) / h);
    for (let i = 1; i < perDay.length; i++) expect(perDay[i]!).toBeLessThan(perDay[i - 1]!);
    expect(perDay[perDay.length - 1]!).toBeGreaterThan(0.0001);
  });
});

describe("distribution shape", () => {
  it("only learns from outcomes known by the as-of date", () => {
    const asOf = "2025-06-30";
    const shape = fitForecastShape(pooled, asOf, H);
    const truncated = pooled.filter((sample) => sample.labelDate <= asOf);
    expect(fitForecastShape(truncated, asOf, H)).toEqual(shape);
    expect(shape.trainedThrough! <= asOf).toBe(true);
    expect(shape.method).toBe("empirical");
  });

  it("falls back to a normal grid on short histories", () => {
    const shape = fitForecastShape(pooled.slice(0, MIN_SHAPE_SAMPLES - 1), THROUGH, H);
    expect(shape.method).toBe("normal");
    expect(shape.sortedZ[500]).toBeCloseTo(0, 2);
  });
});

describe("asset forecast", () => {
  const asset = assets.find((candidate) => candidate.symbol === "NVDA")!;
  const shape = fitForecastShape(pooled, THROUGH, H);
  const make = (probabilityUp: number) =>
    forecastAsset({
      bars: asset.bars,
      states: asset.states,
      shape,
      probabilityUp,
      calendar: NYSE_CALENDAR,
    })!;

  it("builds an ordered cone that starts at the last close", () => {
    const forecast = make(0.55);
    const last = asset.bars[asset.bars.length - 1]!;
    expect(forecast.cone).toHaveLength(H + 1);
    expect(forecast.cone[0]).toMatchObject({ day: 0, p05: last.close, p95: last.close });
    for (const point of forecast.cone.slice(1)) {
      expect(point.p05).toBeLessThan(point.p25);
      expect(point.p25).toBeLessThan(point.p50);
      expect(point.p50).toBeLessThan(point.p75);
      expect(point.p75).toBeLessThan(point.p95);
      expect(point.date > last.date).toBe(true);
    }
    // The band widens with the horizon.
    const width = (day: number) => forecast.cone[day]!.p95 - forecast.cone[day]!.p05;
    expect(width(H)).toBeGreaterThan(width(5));
    // Future dates skip exchange holidays (3 July 2026 is the observed Independence Day).
    expect(forecast.cone.map((point) => point.date)).not.toContain("2026-07-03");
  });

  it("is coherent with the calibrated probability", () => {
    const forecast = make(0.62);
    const positive = forecast.probabilities.find((entry) => entry.key === "positive")!;
    expect(positive.probability).toBeCloseTo(0.62, 2);
    const gain5 = forecast.probabilities.find((entry) => entry.key === "gain-0.05")!;
    const gain10 = forecast.probabilities.find((entry) => entry.key === "gain-0.1")!;
    const loss5 = forecast.probabilities.find((entry) => entry.key === "loss-0.05")!;
    const loss10 = forecast.probabilities.find((entry) => entry.key === "loss-0.1")!;
    expect(gain10.probability).toBeLessThan(gain5.probability);
    expect(gain5.probability).toBeLessThan(positive.probability);
    expect(loss10.probability).toBeLessThan(loss5.probability);
    expect(forecast.expectedShortfall95).toBeLessThanOrEqual(forecast.valueAtRisk95);
    // A more bullish calibration moves the whole distribution up.
    expect(make(0.7).returns.p50).toBeGreaterThan(make(0.4).returns.p50);
  });
});

describe("walk-forward evaluation", () => {
  it("scores the distribution out of sample", () => {
    const evaluation = walkForwardForecastEvaluation(
      assets.flatMap((asset) => asset.calibrationSamples),
      pooled,
      { horizonDays: H },
    );
    expect(evaluation.predictions).toBeGreaterThan(1_000);
    expect(evaluation.pitHistogram.reduce((total, share) => total + share, 0)).toBeCloseTo(1, 3);
    // Reasonable (not perfect) calibration on the synthetic universe.
    expect(evaluation.coverage90!).toBeGreaterThan(0.75);
    expect(evaluation.coverage90!).toBeLessThan(0.98);
    expect(evaluation.coverage50!).toBeGreaterThan(0.35);
    expect(evaluation.coverage50!).toBeLessThan(0.65);
    expect(evaluation.averageBandWidth90!).toBeGreaterThan(0);
    expect(evaluation.evaluationStart! < evaluation.evaluationEnd!).toBe(true);
  });
});
