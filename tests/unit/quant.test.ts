import { describe, expect, it } from "vitest";

import {
  correlation,
  covariance,
  ewmaVariance,
  normalCdf,
  normalQuantile,
  quantile,
  quantileSorted,
  shareAbove,
  symmetricEigen,
  wilsonInterval,
} from "@/lib/quant/stats";

describe("quantiles", () => {
  it("interpolates between order statistics (type 7)", () => {
    const sample = [1, 2, 3, 4, 5];
    expect(quantileSorted(sample, 0)).toBe(1);
    expect(quantileSorted(sample, 1)).toBe(5);
    expect(quantileSorted(sample, 0.5)).toBe(3);
    expect(quantileSorted(sample, 0.1)).toBeCloseTo(1.4, 12);
    expect(quantile([5, 1, 4, 2, 3], 0.75)).toBe(4);
    expect(quantileSorted([], 0.5)).toBeNaN();
  });

  it("counts the share strictly above a threshold", () => {
    const sorted = [-2, -1, 0, 0, 1, 3];
    expect(shareAbove(sorted, 0)).toBeCloseTo(2 / 6, 12);
    expect(shareAbove(sorted, -5)).toBe(1);
    expect(shareAbove(sorted, 3)).toBe(0);
  });
});

describe("intervals and the normal distribution", () => {
  it("gives Wilson intervals that contain the estimate and stay in [0, 1]", () => {
    const { lower, upper } = wilsonInterval(55, 100);
    expect(lower).toBeLessThan(0.55);
    expect(upper).toBeGreaterThan(0.55);
    expect(upper - lower).toBeCloseTo(0.19, 1);
    expect(wilsonInterval(0, 10).lower).toBe(0);
    expect(wilsonInterval(10, 10).upper).toBe(1);
    expect(wilsonInterval(0, 0)).toEqual({ lower: 0, upper: 1 });
  });

  it("inverts the normal CDF", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 4);
    for (const p of [0.001, 0.01, 0.05, 0.3, 0.5, 0.8, 0.95, 0.999]) {
      expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 6);
    }
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
  });
});

describe("co-movement", () => {
  it("computes covariance and correlation", () => {
    const a = [1, 2, 3, 4, 5];
    expect(covariance(a, a)).toBeCloseTo(2.5, 12);
    expect(correlation(a, [2, 4, 6, 8, 10])).toBeCloseTo(1, 12);
    expect(correlation(a, [5, 4, 3, 2, 1])).toBeCloseTo(-1, 12);
    expect(correlation(a, [3, 3, 3, 3, 3])).toBe(0);
  });

  it("decomposes a symmetric matrix", () => {
    const matrix = [
      [1, 0.8, 0.2],
      [0.8, 1, 0.3],
      [0.2, 0.3, 1],
    ];
    const { values, vectors } = symmetricEigen(matrix);
    expect(values.reduce((total, value) => total + value, 0)).toBeCloseTo(3, 10);
    expect(values[0]).toBeGreaterThan(values[1] as number);
    // A·v = λ·v for every pair, and eigenvectors are orthonormal.
    vectors.forEach((vector, k) => {
      const product = matrix.map((row) =>
        row.reduce((sum, value, j) => sum + value * vector[j]!, 0),
      );
      product.forEach((value, i) => expect(value).toBeCloseTo(values[k]! * vector[i]!, 9));
      expect(vector.reduce((sum, value) => sum + value * value, 0)).toBeCloseTo(1, 10);
    });
    const dot = vectors[0]!.reduce((sum, value, i) => sum + value * vectors[1]![i]!, 0);
    expect(dot).toBeCloseTo(0, 10);
  });
});

describe("EWMA variance", () => {
  it("is causal and reacts to recent shocks", () => {
    const calm = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
    const shocked = [...calm, 0.08];
    const base = ewmaVariance(calm);
    const after = ewmaVariance(shocked);
    expect(base[18]).toBeNull();
    expect(base[19]).toBeCloseTo(0.0001, 10);
    // Appending a return never changes earlier forecasts…
    expect(after.slice(0, calm.length)).toEqual(base);
    // …and a large move lifts the next forecast.
    expect(after[after.length - 1]!).toBeGreaterThan(base[base.length - 1]!);
  });
});
