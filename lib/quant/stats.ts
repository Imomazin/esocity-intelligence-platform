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

// ─── Distributions and intervals ─────────────────────────────────────────────────────────────

/**
 * Quantile of an ASCENDING-sorted sample with linear interpolation between order statistics
 * (Hyndman & Fan type 7 — the R / NumPy default). `q` is clamped to [0, 1].
 */
export function quantileSorted(sorted: readonly number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const position = clamp(q, 0, 1) * (n - 1);
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, n - 1);
  const weight = position - lower;
  return (sorted[lower] as number) * (1 - weight) + (sorted[upper] as number) * weight;
}

/** Quantile of an unsorted sample (sorts a copy). */
export function quantile(values: readonly number[], q: number): number {
  return quantileSorted(
    [...values].sort((a, b) => a - b),
    q,
  );
}

/**
 * Share of an ascending-sorted sample strictly greater than `threshold` (binary search).
 */
export function shareAbove(sorted: readonly number[], threshold: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) <= threshold) lo = mid + 1;
    else hi = mid;
  }
  return (n - lo) / n;
}

/**
 * Wilson score interval for a binomial proportion — well behaved for small samples and for
 * proportions near 0 or 1, unlike the normal approximation. z = 1.96 gives a 95% interval.
 */
export function wilsonInterval(
  successes: number,
  trials: number,
  z = 1.96,
): { lower: number; upper: number } {
  if (trials <= 0) return { lower: 0, upper: 1 };
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return { lower: clamp(centre - margin, 0, 1), upper: clamp(centre + margin, 0, 1) };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation, |error| < 1.5e−7). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Inverse standard normal CDF (Acklam's rational approximation, relative error < 1.2e−9). */
export function normalQuantile(p: number): number {
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  const [a1, a2, a3, a4, a5, a6] = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ] as const;
  const [b1, b2, b3, b4, b5] = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ] as const;
  const [c1, c2, c3, c4, c5, c6] = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ] as const;
  const [d1, d2, d3, d4] = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416,
  ] as const;
  const tail = (q: number) =>
    (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
    ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  const low = 0.02425;
  if (p < low) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - low) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q) /
    (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1)
  );
}

// ─── Co-movement ─────────────────────────────────────────────────────────────────────────────

/** Sample covariance of two equal-length series (n − 1 denominator). */
export function covariance(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return Number.NaN;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i] as number;
    meanB += b[i] as number;
  }
  meanA /= n;
  meanB /= n;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += ((a[i] as number) - meanA) * ((b[i] as number) - meanB);
  return acc / (n - 1);
}

/** Pearson correlation of two equal-length series; 0 when either series is constant. */
export function correlation(a: readonly number[], b: readonly number[]): number {
  const sdA = stdDev(a.slice(0, Math.min(a.length, b.length)));
  const sdB = stdDev(b.slice(0, Math.min(a.length, b.length)));
  if (!(sdA > 0) || !(sdB > 0)) return 0;
  return clamp(covariance(a, b) / (sdA * sdB), -1, 1);
}

export interface EigenDecomposition {
  /** Eigenvalues, descending. */
  values: number[];
  /** vectors[k] is the unit eigenvector for values[k]. */
  vectors: number[][];
}

/**
 * Eigen-decomposition of a small SYMMETRIC matrix by the cyclic Jacobi method — robust and
 * exact enough for correlation matrices of a few dozen assets.
 */
export function symmetricEigen(
  matrix: readonly (readonly number[])[],
  options: { maxSweeps?: number; tolerance?: number } = {},
): EigenDecomposition {
  const { maxSweeps = 100, tolerance = 1e-12 } = options;
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  const at = (i: number, j: number) => (a[i] as number[])[j] as number;

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let offDiagonal = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) offDiagonal += at(p, q) ** 2;
    }
    if (offDiagonal < tolerance) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = at(p, q);
        if (Math.abs(apq) < 1e-300) continue;
        // Rotation J(p, q, θ) chosen so that (JᵀAJ)_pq = 0.
        const theta = (at(q, q) - at(p, p)) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (const row of a) {
          const kp = row[p] as number;
          const kq = row[q] as number;
          row[p] = c * kp - s * kq;
          row[q] = s * kp + c * kq;
        }
        const rowP = a[p] as number[];
        const rowQ = a[q] as number[];
        for (let k = 0; k < n; k++) {
          const pk = rowP[k] as number;
          const qk = rowQ[k] as number;
          rowP[k] = c * pk - s * qk;
          rowQ[k] = s * pk + c * qk;
        }
        for (const row of v) {
          const kp = row[p] as number;
          const kq = row[q] as number;
          row[p] = c * kp - s * kq;
          row[q] = s * kp + c * kq;
        }
      }
    }
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => at(j, j) - at(i, i));
  return {
    values: order.map((i) => at(i, i)),
    vectors: order.map((i) => v.map((row) => row[i] as number)),
  };
}

/**
 * RiskMetrics EWMA variance of a return series: v_t = λ·v_{t−1} + (1 − λ)·r_t², seeded with the
 * mean squared return of the first `seedLength` returns (RiskMetrics assumes a zero daily mean).
 * v_t is the one-step-ahead variance forecast made at the close of t — it uses returns up to and
 * including t only (causal). Entries before the seed completes are null.
 */
export function ewmaVariance(
  returns: readonly number[],
  lambda = 0.94,
  seedLength = 20,
): (number | null)[] {
  const out: (number | null)[] = new Array(returns.length).fill(null);
  if (returns.length < seedLength) return out;
  let v = mean(returns.slice(0, seedLength).map((r) => r * r));
  out[seedLength - 1] = v;
  for (let t = seedLength; t < returns.length; t++) {
    const r = returns[t] as number;
    v = lambda * v + (1 - lambda) * r * r;
    out[t] = v;
  }
  return out;
}
