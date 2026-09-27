import { linearRegression, stdDev, TRADING_DAYS_PER_YEAR } from "@/lib/quant/stats";

/**
 * Technical indicators.
 *
 * Every function returns a series aligned 1:1 with its input. Warm-up positions are `null`.
 * All indicators are CAUSAL: the value at index t depends only on inputs[0..t]. The backtesting
 * engine relies on this property to be free of look-ahead bias (verified by unit tests).
 */

export type Series = (number | null)[];

/** Simple returns r_t = c_t / c_{t−1} − 1. */
export function simpleReturns(closes: readonly number[]): Series {
  return closes.map((close, i) => (i === 0 ? null : close / (closes[i - 1] as number) - 1));
}

/** Log returns ln(c_t / c_{t−1}). */
export function logReturns(closes: readonly number[]): Series {
  return closes.map((close, i) => (i === 0 ? null : Math.log(close / (closes[i - 1] as number))));
}

/** Simple moving average over `period` observations. */
export function sma(values: readonly number[], period: number): Series {
  if (period < 1) throw new Error("SMA period must be >= 1");
  const out: Series = new Array(values.length).fill(null);
  let windowSum = 0;
  for (let i = 0; i < values.length; i++) {
    windowSum += values[i] as number;
    if (i >= period) windowSum -= values[i - period] as number;
    if (i >= period - 1) out[i] = windowSum / period;
  }
  return out;
}

/**
 * Exponential moving average with α = 2 / (period + 1), seeded with the SMA of the first
 * `period` values (the standard convention).
 */
export function ema(values: readonly number[], period: number): Series {
  if (period < 1) throw new Error("EMA period must be >= 1");
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const alpha = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i] as number;
  let previous = seed / period;
  out[period - 1] = previous;
  for (let i = period; i < values.length; i++) {
    previous = alpha * (values[i] as number) + (1 - alpha) * previous;
    out[i] = previous;
  }
  return out;
}

/** EMA over a series that may begin with nulls (e.g. the MACD line). */
function emaOfSeries(series: Series, period: number): Series {
  const out: Series = new Array(series.length).fill(null);
  const firstDefined = series.findIndex((value) => value !== null);
  if (firstDefined < 0) return out;
  const tail = series.slice(firstDefined) as number[];
  const smoothed = ema(tail, period);
  smoothed.forEach((value, offset) => {
    out[firstDefined + offset] = value;
  });
  return out;
}

/**
 * Relative Strength Index (Wilder, 1978). The first average gain/loss is the simple mean of the
 * first `period` changes; subsequent values use Wilder's smoothing: avg = (prev·(n−1) + x) / n.
 */
export function rsi(closes: readonly number[], period = 14): Series {
  const out: Series = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = (closes[i] as number) - (closes[i - 1] as number);
    if (change > 0) gainSum += change;
    else lossSum -= change;
  }
  let averageGain = gainSum / period;
  let averageLoss = lossSum / period;
  out[period] = rsiFromAverages(averageGain, averageLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = (closes[i] as number) - (closes[i - 1] as number);
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    out[i] = rsiFromAverages(averageGain, averageLoss);
  }
  return out;
}

function rsiFromAverages(averageGain: number, averageLoss: number): number {
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

export interface MacdSeries {
  macd: Series;
  signal: Series;
  histogram: Series;
}

/** MACD (12, 26, 9): EMA(fast) − EMA(slow), its EMA signal line, and the histogram. */
export function macd(
  closes: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdSeries {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const line: Series = closes.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f === null || f === undefined || s === null || s === undefined ? null : f - s;
  });
  const signal = emaOfSeries(line, signalPeriod);
  const histogram: Series = line.map((value, i) => {
    const s = signal[i];
    return value === null || s === null || s === undefined ? null : value - s;
  });
  return { macd: line, signal, histogram };
}

/** Rate of change (momentum): c_t / c_{t−period} − 1. */
export function rateOfChange(closes: readonly number[], period: number): Series {
  return closes.map((close, i) => (i < period ? null : close / (closes[i - period] as number) - 1));
}

/**
 * Rolling annualised volatility of daily log returns over `window` returns
 * (sample standard deviation × √252). First defined at index `window`.
 */
export function rollingVolatility(closes: readonly number[], window = 20): Series {
  const returns = logReturns(closes);
  const out: Series = new Array(closes.length).fill(null);
  for (let i = window; i < closes.length; i++) {
    const slice = returns.slice(i - window + 1, i + 1) as number[];
    out[i] = stdDev(slice) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  }
  return out;
}

/** Percentage drawdown from the running peak: c_t / max(c_0..c_t) − 1 (≤ 0). */
export function drawdownSeries(closes: readonly number[]): number[] {
  let peak = Number.NEGATIVE_INFINITY;
  return closes.map((close) => {
    peak = Math.max(peak, close);
    return close / peak - 1;
  });
}

/**
 * Trend strength in [−1, 1]: tanh( (annualised OLS slope of log price ÷ annualised volatility)
 * × R² ) over `window` bars. Direction comes from the slope, magnitude is scaled by how
 * consistently prices follow the fitted line (R²) relative to noise.
 */
export function trendStrength(closes: readonly number[], window = 50): Series {
  const out: Series = new Array(closes.length).fill(null);
  if (closes.length < window) return out;
  const logs = closes.map((close) => Math.log(close));
  for (let i = window - 1; i < closes.length; i++) {
    const segment = logs.slice(i - window + 1, i + 1);
    const fit = linearRegression(segment);
    const dailyReturns = segment.slice(1).map((value, k) => value - (segment[k] as number));
    const volatility = stdDev(dailyReturns) * Math.sqrt(TRADING_DAYS_PER_YEAR);
    if (!Number.isFinite(volatility) || volatility === 0) {
      out[i] = 0;
      continue;
    }
    const ratio = (fit.slope * TRADING_DAYS_PER_YEAR) / volatility;
    out[i] = Math.tanh(ratio * fit.rSquared);
  }
  return out;
}

/**
 * Rolling percentile rank of each value within its trailing `lookback` window (inclusive).
 * Requires at least `minSamples` defined observations; otherwise null.
 */
export function rollingPercentileRank(series: Series, lookback = 252, minSamples = 60): Series {
  return series.map((value, i) => {
    if (value === null) return null;
    // Mid-rank percentile (same convention as stats.percentileRank), computed without
    // allocating a window array — this runs for every bar of every asset.
    let count = 0;
    let below = 0;
    let equal = 0;
    for (let j = Math.max(0, i - lookback + 1); j <= i; j++) {
      const entry = series[j];
      if (entry === null || entry === undefined) continue;
      count += 1;
      if (entry < value) below += 1;
      else if (entry === value) equal += 1;
    }
    if (count < minSamples) return null;
    return (below + 0.5 * equal) / count;
  });
}
