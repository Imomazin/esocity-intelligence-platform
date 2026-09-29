import { describe, expect, it } from "vitest";

import { betaToBenchmark, correlationMatrix } from "@/lib/markets/correlation";
import {
  REGIME_ORDER,
  regimeProfiles,
  regimeSegments,
  regimeStatus,
  regimeTransitionMatrix,
} from "@/lib/markets/regime-analysis";
import { buildFeatureRows } from "@/lib/markets/signal-engine";
import { generateSyntheticHistory } from "@/lib/markets/synthetic";
import type { PriceBar } from "@/lib/markets/types";
import { DEMO_SYMBOLS } from "@/lib/markets/universe";

const THROUGH = "2026-06-30";
const universe = DEMO_SYMBOLS.map((symbol) => {
  const bars = generateSyntheticHistory(symbol, THROUGH);
  return { symbol, bars, rows: buildFeatureRows(bars) };
});

describe("regime dynamics", () => {
  const rows = universe[0]!.rows;

  it("splits history into contiguous runs", () => {
    const segments = regimeSegments(rows);
    const classified = rows.filter((row) => row.regime !== null).length;
    expect(segments.reduce((total, segment) => total + segment.sessions, 0)).toBe(classified);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.regime).not.toBe(segments[i - 1]!.regime);
      expect(segments[i]!.startDate > segments[i - 1]!.endDate).toBe(true);
    }
    expect(segments[segments.length - 1]!.completed).toBe(false);
  });

  it("estimates horizon transitions from known pairs only", () => {
    const matrix = regimeTransitionMatrix(universe, 20);
    matrix.probabilities.forEach((row, i) => {
      if (matrix.totals[i]! > 0) {
        expect(row.reduce((total, p) => total + p, 0)).toBeCloseTo(1, 3);
      }
    });
    const asOf = "2025-06-30";
    const cut = universe.map((entry) => ({ rows: entry.rows.filter((row) => row.date <= asOf) }));
    expect(regimeTransitionMatrix(universe, 20, asOf)).toEqual(regimeTransitionMatrix(cut, 20));
    expect(regimeTransitionMatrix(cut, 20).samples).toBeLessThan(matrix.samples);
  });

  it("profiles each regime and the current state", () => {
    const profiles = regimeProfiles(universe, 20);
    expect(profiles.map((profile) => profile.regime)).toEqual(REGIME_ORDER);
    expect(profiles.reduce((total, profile) => total + profile.share, 0)).toBeCloseTo(1, 3);
    for (const profile of profiles) {
      if (profile.hitRate !== null) {
        expect(profile.hitRateLower!).toBeLessThanOrEqual(profile.hitRate);
        expect(profile.hitRateUpper!).toBeGreaterThanOrEqual(profile.hitRate);
      }
    }
    const status = regimeStatus(rows, regimeTransitionMatrix(universe, 20), profiles)!;
    expect(status.regime).toBe(rows[rows.length - 1]!.regime);
    expect(status.sessions).toBeGreaterThanOrEqual(1);
    expect(status.persistence).toBeGreaterThanOrEqual(0);
    expect(status.mostLikelyNext).not.toBeNull();
  });
});

function barsFromReturns(returns: readonly number[], start = 100): PriceBar[] {
  let close = start;
  return returns.map((r, i) => {
    close *= Math.exp(r);
    const date = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
    return { date, open: close, high: close, low: close, close, volume: 1 };
  });
}

describe("co-movement", () => {
  it("builds a symmetric, seriated correlation matrix", () => {
    const result = correlationMatrix(universe, 63)!;
    const n = universe.length;
    expect(result.symbols).toHaveLength(n);
    expect([...result.symbols].sort()).toEqual([...DEMO_SYMBOLS].sort());
    result.matrix.forEach((row, i) => {
      expect(row[i]).toBe(1);
      row.forEach((value, j) => {
        expect(value).toBeCloseTo(result.matrix[j]![i]!, 10);
        expect(Math.abs(value)).toBeLessThanOrEqual(1);
      });
    });
    expect(result.window).toBe(63);
    expect(result.independentDrivers).toBeGreaterThanOrEqual(1);
    expect(result.independentDrivers).toBeLessThanOrEqual(n);
  });

  it("recognises duplicated exposures", () => {
    const base = Array.from({ length: 80 }, (_, i) => 0.01 * Math.sin(i * 1.3));
    const other = Array.from({ length: 80 }, (_, i) => 0.01 * Math.cos(i * 0.37 + 1));
    const result = correlationMatrix(
      [
        { symbol: "A", bars: barsFromReturns(base) },
        { symbol: "C", bars: barsFromReturns(other) },
        { symbol: "B", bars: barsFromReturns(base, 50) },
      ],
      63,
    )!;
    const a = result.symbols.indexOf("A");
    const b = result.symbols.indexOf("B");
    expect(Math.abs(a - b)).toBe(1);
    expect(result.matrix[a]![b]).toBeCloseTo(1, 6);
    expect(result.independentDrivers).toBeGreaterThan(1.4);
    expect(result.independentDrivers).toBeLessThan(2.1);
  });

  it("estimates beta against the benchmark", () => {
    const market = Array.from({ length: 300 }, (_, i) => 0.01 * Math.sin(i * 0.9));
    const beta = betaToBenchmark(
      barsFromReturns(market.map((r) => 1.5 * r)),
      barsFromReturns(market),
      252,
    )!;
    expect(beta.beta).toBeCloseTo(1.5, 6);
    expect(beta.correlation).toBeCloseTo(1, 6);
    expect(beta.samples).toBe(252);
  });
});
