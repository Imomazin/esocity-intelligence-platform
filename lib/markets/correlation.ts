import type { PriceBar } from "@/lib/markets/types";
import { correlation, covariance, round, symmetricEigen, variance } from "@/lib/quant/stats";

/**
 * Cross-asset co-movement: return correlations on common trading dates, a seriated order that
 * places similar assets next to each other, how many independent return drivers the universe
 * really offers, and each asset's beta to the benchmark.
 */

export interface SymbolBars {
  symbol: string;
  bars: readonly PriceBar[];
}

export interface CorrelationMatrix {
  /** Symbols in seriated order (similar assets adjacent). */
  symbols: string[];
  /** matrix[i][j] = correlation of daily log returns, in `symbols` order. */
  matrix: number[][];
  window: number;
  start: string;
  end: string;
  /** Mean of the off-diagonal correlations. */
  averageCorrelation: number;
  /** Participation ratio of the eigenvalues: 1 = one common driver, n = fully independent. */
  independentDrivers: number;
  /** Share of total variance explained by the first principal component. */
  firstFactorShare: number;
}

export interface BetaEstimate {
  beta: number;
  correlation: number;
  rSquared: number;
  samples: number;
}

/** Closes on the last `window + 1` dates common to every series (ascending). */
export function alignedCloses(
  series: readonly SymbolBars[],
  window: number,
): { dates: string[]; closes: Map<string, number[]> } | null {
  if (series.length === 0) return null;
  const lookups = series.map(
    ({ symbol, bars }) => [symbol, new Map(bars.map((bar) => [bar.date, bar.close]))] as const,
  );
  const [first, ...rest] = lookups;
  const common = [...(first as (typeof lookups)[number])[1].keys()]
    .filter((date) => rest.every(([, map]) => map.has(date)))
    .sort();
  const dates = common.slice(-(window + 1));
  if (dates.length < Math.min(window + 1, 30)) return null;
  return {
    dates,
    closes: new Map(
      lookups.map(([symbol, map]) => [symbol, dates.map((date) => map.get(date) as number)]),
    ),
  };
}

/** Daily log returns on the last `window` dates common to every series. */
export function alignedReturns(
  series: readonly SymbolBars[],
  window: number,
): { dates: string[]; returns: Map<string, number[]> } | null {
  const aligned = alignedCloses(series, window);
  if (!aligned) return null;
  const returns = new Map<string, number[]>();
  for (const [symbol, closes] of aligned.closes) {
    returns.set(
      symbol,
      closes.slice(1).map((close, i) => Math.log(close / (closes[i] as number))),
    );
  }
  return { dates: aligned.dates, returns };
}

/**
 * Order assets by the angle of their loadings on the first two principal components — a
 * standard seriation that makes correlation blocks visible in a heatmap.
 */
function seriate(symbols: readonly string[], matrix: readonly (readonly number[])[]): number[] {
  const { vectors } = symmetricEigen(matrix);
  const v1 = vectors[0] ?? [];
  const v2 = vectors[1] ?? new Array(symbols.length).fill(0);
  const sign1 = v1.reduce((total, value) => total + value, 0) >= 0 ? 1 : -1;
  const pivot = v2.find((value) => Math.abs(value) > 1e-9) ?? 1;
  const sign2 = pivot >= 0 ? 1 : -1;
  return symbols
    .map((_, i) => ({ i, angle: Math.atan2(sign2 * (v2[i] ?? 0), sign1 * (v1[i] ?? 0)) }))
    .sort((a, b) => a.angle - b.angle || a.i - b.i)
    .map((entry) => entry.i);
}

export function correlationMatrix(
  series: readonly SymbolBars[],
  window = 63,
): CorrelationMatrix | null {
  if (series.length < 2) return null;
  const aligned = alignedReturns(series, window);
  if (!aligned) return null;
  const symbols = series.map((entry) => entry.symbol);
  const raw = symbols.map((a) =>
    symbols.map((b) =>
      a === b
        ? 1
        : correlation(aligned.returns.get(a) as number[], aligned.returns.get(b) as number[]),
    ),
  );
  const order = seriate(symbols, raw);
  const matrix = order.map((i) => order.map((j) => round((raw[i] as number[])[j] as number, 4)));

  let offDiagonal = 0;
  let pairs = 0;
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      offDiagonal += (raw[i] as number[])[j] as number;
      pairs += 1;
    }
  }
  const { values } = symmetricEigen(raw);
  const positive = values.map((value) => Math.max(value, 0));
  const total = positive.reduce((sum, value) => sum + value, 0);
  const squares = positive.reduce((sum, value) => sum + value * value, 0);

  return {
    symbols: order.map((i) => symbols[i] as string),
    matrix,
    window: aligned.dates.length - 1,
    start: aligned.dates[0] as string,
    end: aligned.dates[aligned.dates.length - 1] as string,
    averageCorrelation: round(pairs > 0 ? offDiagonal / pairs : 0, 4),
    independentDrivers: round(squares > 0 ? (total * total) / squares : symbols.length, 2),
    firstFactorShare: round(total > 0 ? (positive[0] ?? 0) / total : 0, 4),
  };
}

/** OLS beta of the asset's daily log returns on the benchmark's, over the last `window` days. */
export function betaToBenchmark(
  asset: readonly PriceBar[],
  benchmark: readonly PriceBar[],
  window = 252,
): BetaEstimate | null {
  const aligned = alignedReturns(
    [
      { symbol: "asset", bars: asset },
      { symbol: "benchmark", bars: benchmark },
    ],
    window,
  );
  if (!aligned) return null;
  const a = aligned.returns.get("asset") as number[];
  const m = aligned.returns.get("benchmark") as number[];
  const marketVariance = variance(m);
  if (!(marketVariance > 0)) return null;
  const rho = correlation(a, m);
  return {
    beta: round(covariance(a, m) / marketVariance, 4),
    correlation: round(rho, 4),
    rSquared: round(rho * rho, 4),
    samples: a.length,
  };
}
