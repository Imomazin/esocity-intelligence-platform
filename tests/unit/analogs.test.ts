import { describe, expect, it } from "vitest";

import {
  ANALOG_COUNT,
  ANALOG_SEPARATION,
  buildAnalogUniverse,
  findAnalogs,
  walkForwardAnalogEvaluation,
  type AnalogInput,
} from "@/lib/markets/analogs";
import { buildFeatureRows, SIGNAL_HORIZON_DAYS } from "@/lib/markets/signal-engine";
import { generateSyntheticHistory } from "@/lib/markets/synthetic";
import { DEMO_SYMBOLS } from "@/lib/markets/universe";

const H = SIGNAL_HORIZON_DAYS;

function inputs(through: string, cutoff?: string): AnalogInput[] {
  return DEMO_SYMBOLS.map((symbol) => {
    const bars = generateSyntheticHistory(symbol, through).filter(
      (bar) => !cutoff || bar.date <= cutoff,
    );
    return { symbol, bars, features: buildFeatureRows(bars) };
  });
}

const full = buildAnalogUniverse(inputs("2026-06-30"), H);

describe("historical analogs", () => {
  const result = findAnalogs(full, "META")!;

  it("returns k separated analogs ranked by similarity", () => {
    expect(result.analogs).toHaveLength(ANALOG_COUNT);
    const similarities = result.analogs.map((analog) => analog.similarity);
    expect([...similarities].sort((a, b) => b - a)).toEqual(similarities);
    const bySymbol = new Map<string, number[]>();
    for (const analog of result.analogs) {
      const bars = full.inputs.get(analog.symbol)!.bars;
      const index = bars.findIndex((bar) => bar.date === analog.date);
      for (const other of bySymbol.get(analog.symbol) ?? []) {
        expect(Math.abs(other - index)).toBeGreaterThanOrEqual(ANALOG_SEPARATION);
      }
      bySymbol.set(analog.symbol, [...(bySymbol.get(analog.symbol) ?? []), index]);
    }
  });

  it("only uses setups whose outcome was known at the query date", () => {
    for (const analog of result.analogs) {
      const bars = full.inputs.get(analog.symbol)!.bars;
      const index = bars.findIndex((bar) => bar.date === analog.date);
      expect(bars[index + H]!.date <= result.asOf).toBe(true);
      expect(analog.path[0]).toBe(0);
      expect(analog.path[H]).toBeCloseTo(analog.forwardReturn, 6);
    }
  });

  it("is invariant to data after the query date", () => {
    const cutoff = "2025-03-31";
    const truncated = buildAnalogUniverse(inputs("2026-06-30", cutoff), H);
    const meta = full.inputs.get("META")!.bars;
    const index = meta.findIndex((bar) => bar.date === cutoff);
    expect(findAnalogs(full, "META", { index })).toEqual(findAnalogs(truncated, "META"));
  });

  it("summarises the analog outcomes honestly", () => {
    const { summary } = result;
    const positives = result.analogs.filter((analog) => analog.forwardReturn > 0).length;
    expect(summary.hitRate).toBeCloseTo(positives / ANALOG_COUNT, 4);
    expect(summary.hitRateLower).toBeLessThanOrEqual(summary.hitRate);
    expect(summary.hitRateUpper).toBeGreaterThanOrEqual(summary.hitRate);
    expect(summary.p10).toBeLessThanOrEqual(summary.p25);
    expect(summary.p25).toBeLessThanOrEqual(summary.medianReturn);
    expect(summary.medianReturn).toBeLessThanOrEqual(summary.p75);
    expect(result.pathBands).toHaveLength(H + 1);
    expect(result.pathBands[0]).toEqual({ day: 0, p25: 0, p50: 0, p75: 0 });
    expect(result.features.map((feature) => feature.key)).toContain("fromHigh");
  });

  it("is evaluated walk-forward against the base rate", () => {
    const evaluation = walkForwardAnalogEvaluation(full);
    expect(evaluation.predictions).toBeGreaterThan(300);
    expect(evaluation.brierScore).toBeGreaterThan(0);
    expect(evaluation.baselineBrierScore).toBeGreaterThan(0);
    expect(evaluation.brierSkillScore).not.toBeNull();
  });

  it("returns null for unknown symbols", () => {
    expect(findAnalogs(full, "ZZZZ")).toBeNull();
  });
});
