/**
 * Small, dependency-free statistics helpers shared by the quantitative engines.
 * Functions are pure and deterministic; callers own warm-up/NaN handling.
 */

export const TRADING_DAYS_PER_YEAR = 252;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return sum(values) / values.length;
}

/** Sample variance (n − 1 denominator). */
export function variance(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return Number.NaN;
  const mu = mean(values);
  let acc = 0;
  for (const value of values) acc += (value - mu) ** 2;
  return acc / (n - 1);
}

/** Sample standard deviation (n − 1 denominator). */
export function stdDev(values: readonly number[]): number {
  return Math.sqrt(variance(values));
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/**
 * Percentile rank of `value` within `sample`, in [0, 1]: the share of observations strictly
 * below the value plus half of the ties (mid-rank convention).
 */
export function percentileRank(sample: readonly number[], value: number): number {
  if (sample.length === 0) return Number.NaN;
  let below = 0;
  let equal = 0;
  for (const observation of sample) {
    if (observation < value) below += 1;
    else if (observation === value) equal += 1;
  }
  return (below + 0.5 * equal) / sample.length;
}

export interface LinearFit {
  slope: number;
  intercept: number;
  rSquared: number;
}

/** Ordinary least squares fit of `values` against x = 0..n−1. */
export function linearRegression(values: readonly number[]): LinearFit {
  const n = values.length;
  if (n < 2) return { slope: Number.NaN, intercept: Number.NaN, rSquared: Number.NaN };
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    const dy = (values[i] as number) - yMean;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxy / sxx;
  const intercept = yMean - slope * xMean;
  const rSquared = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, rSquared };
}

export function logistic(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

export interface LogisticFit {
  intercept: number;
  slope: number;
  samples: number;
  converged: boolean;
}

/**
 * One-feature logistic regression P(y = 1 | x) = σ(a + b·x), fitted by Newton–Raphson with
 * an L2 (ridge) penalty on the SLOPE only. The intercept is unpenalised (standard practice) so
 * the fit always reproduces the sample base rate; shrinking the slope pulls predictions toward
 * that base rate — i.e. toward "no edge beyond the base rate" — on weak evidence.
 */
export function fitLogistic1D(
  xs: readonly number[],
  ys: readonly number[],
  options: { l2?: number; maxIterations?: number; tolerance?: number } = {},
): LogisticFit {
  const { l2 = 1, maxIterations = 50, tolerance = 1e-9 } = options;
  const n = Math.min(xs.length, ys.length);
  let a = 0;
  let b = 0;
  let converged = false;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let gA = 0;
    let gB = -l2 * b;
    let hAA = 0;
    let hAB = 0;
    let hBB = -l2;
    for (let i = 0; i < n; i++) {
      const x = xs[i] as number;
      const y = ys[i] as number;
      const p = logistic(a + b * x);
      const residual = y - p;
      const weight = p * (1 - p);
      gA += residual;
      gB += residual * x;
      hAA -= weight;
      hAB -= weight * x;
      hBB -= weight * x * x;
    }
    const determinant = hAA * hBB - hAB * hAB;
    if (Math.abs(determinant) < 1e-12) break;
    // Newton step: θ ← θ − H⁻¹ g
    const stepA = (hBB * gA - hAB * gB) / determinant;
    const stepB = (hAA * gB - hAB * gA) / determinant;
    a -= stepA;
    b -= stepB;
    if (Math.abs(stepA) + Math.abs(stepB) < tolerance) {
      converged = true;
      break;
    }
  }

  return { intercept: a, slope: b, samples: n, converged };
}

/** Maximum peak-to-trough decline of a value series, returned as a negative ratio (e.g. −0.18). */
export function maxDrawdown(values: readonly number[]): number {
  let peak = Number.NEGATIVE_INFINITY;
  let worst = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value > peak) peak = value;
    if (peak > 0) {
      const drawdown = value / peak - 1;
      if (drawdown < worst) worst = drawdown;
    }
  }
  return worst;
}

/** Simple period returns r_t = v_t / v_{t−1} − 1 (length n − 1). */
export function periodReturns(values: readonly number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const previous = values[i - 1] as number;
    const current = values[i] as number;
    returns.push(previous === 0 ? 0 : current / previous - 1);
  }
  return returns;
}

/** Annualised volatility from daily simple returns. */
export function annualisedVolatility(dailyReturns: readonly number[]): number {
  if (dailyReturns.length < 2) return 0;
  return stdDev(dailyReturns) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/** Sharpe-like ratio with a zero risk-free rate: mean / stdev × √252. */
export function sharpeLikeRatio(dailyReturns: readonly number[]): number {
  if (dailyReturns.length < 2) return 0;
  const sd = stdDev(dailyReturns);
  if (!Number.isFinite(sd) || sd === 0) return 0;
  return (mean(dailyReturns) / sd) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}
