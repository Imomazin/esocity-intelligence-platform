import { describe, expect, it } from "vitest";

import {
  buildCalibrationSamples,
  calibratedProbability,
  fitCalibrationModel,
} from "@/lib/markets/calibration";
import { buildFeatureRows } from "@/lib/markets/signal-engine";
import { generateSyntheticHistory } from "@/lib/markets/synthetic";
import { DEMO_SYMBOLS } from "@/lib/markets/universe";
import { riskLevelFromScore } from "@/lib/risk-levels";

describe("synthetic market data", () => {
  it("is deterministic and prefix-stable", () => {
    const a = generateSyntheticHistory("AAPL", "2026-06-30");
    const b = generateSyntheticHistory("AAPL", "2026-09-25");
    expect(b.slice(0, a.length)).toEqual(a);
  });

  it.each(DEMO_SYMBOLS)("%s has consistent OHLC bars on business days", (symbol) => {
    const bars = generateSyntheticHistory(symbol, "2026-09-25");
    for (const bar of bars) {
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.low).toBeGreaterThan(0);
      const day = new Date(`${bar.date}T00:00:00Z`).getUTCDay();
      expect(day).not.toBe(0);
      expect(day).not.toBe(6);
    }
  });
});

describe("walk-forward calibration", () => {
  const rows = buildFeatureRows(generateSyntheticHistory("MSFT", "2026-09-25"));
  const samples = buildCalibrationSamples("MSFT", rows, 20);

  it("labels each sample with the date its outcome became known", () => {
    for (const sample of samples.slice(0, 50)) expect(sample.labelDate > sample.date).toBe(true);
  });

  it("never trains on labels unknown at the fit date", () => {
    const asOf = samples[400]!.date;
    const model = fitCalibrationModel(samples, asOf, 20);
    expect(model.trainedThrough! <= asOf).toBe(true);
    expect(model.samples).toBe(samples.filter((sample) => sample.labelDate <= asOf).length);
  });

  it("maps scores to bounded probabilities, monotone in the score when the slope is positive", () => {
    const model = fitCalibrationModel(samples, rows.at(-1)!.date, 20);
    const low = calibratedProbability(model, -0.8);
    const high = calibratedProbability(model, 0.8);
    for (const p of [low, high]) {
      expect(p).toBeGreaterThanOrEqual(0.02);
      expect(p).toBeLessThanOrEqual(0.98);
    }
    if (model.slope > 0) expect(high).toBeGreaterThan(low);
  });

  it("uses the published four-level risk bands", () => {
    expect([0, 24.9, 25, 49, 50, 74, 75, 100].map(riskLevelFromScore)).toEqual([
      "LOW",
      "LOW",
      "MODERATE",
      "MODERATE",
      "HIGH",
      "HIGH",
      "VERY_HIGH",
      "VERY_HIGH",
    ]);
  });
});
