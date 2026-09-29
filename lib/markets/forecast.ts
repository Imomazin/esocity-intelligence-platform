import { nextTradingDays, WEEKDAY_CALENDAR, type TradingCalendar } from "@/lib/clock";
import {
  calibratedProbability,
  fitCalibrationModel,
  type CalibrationModel,
  type CalibrationSample,
} from "@/lib/markets/calibration";
import type { PriceBar } from "@/lib/markets/types";
import {
  ewmaVariance,
  mean,
  normalQuantile,
  quantileSorted,
  round,
  shareAbove,
  TRADING_DAYS_PER_YEAR,
} from "@/lib/quant/stats";

/**
 * Esocity forward distribution (model key: markets.forecast-distribution).
 *
 * Turns the composite signal's calibrated P(up) into a full distribution of the h-day return:
 *
 *   1. Volatility — RiskMetrics EWMA (λ = 0.94) one-day variance v_t, mean-reverting toward the
 *      trailing one-year variance v̄_t with daily persistence φ = 0.97:
 *        σ²(t, h) = h·v̄_t + (v_t − v̄_t)·(1 − φʰ)/(1 − φ)
 *      so a volatility spike widens the near-term cone more than the far end.
 *   2. Shape — standardised outcomes z = ln(C_{s+h} / C_s) / σ(s, h), pooled across the universe
 *      (filtered historical simulation). Fat tails, skew and any systematic mis-scaling of the
 *      volatility model are inherited from history rather than assumed away. Only windows whose
 *      outcome was known by the as-of date are used (no look-ahead).
 *   3. Location — shifted so that P(return > 0) equals the calibrated P(up), making the cone and
 *      the headline probability one coherent forecast.
 *
 * Everything is causal: a forecast dated t uses bars[0..t] and outcomes known by t.
 */

export const FORECAST_MODEL_VERSION = "1.0.0";
export const EWMA_LAMBDA = 0.94;
export const VOLATILITY_PERSISTENCE = 0.97;
export const LONG_RUN_WINDOW = 252;
const LONG_RUN_MIN_RETURNS = 60;
/** Below this many pooled outcomes the shape falls back to a standard normal. */
export const MIN_SHAPE_SAMPLES = 250;
const NORMAL_GRID_SIZE = 1_000;
export const FORECAST_QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95] as const;
/** Move sizes whose probabilities are reported (simple returns). */
export const FORECAST_THRESHOLDS = [0.05, 0.1] as const;

export interface VolatilityState {
  /** EWMA one-day log-return variance forecast made at this close. */
  ewma: number;
  /** Mean squared daily log return over the trailing year. */
  longRun: number;
}

export interface ForecastSample {
  symbol: string;
  /** Forecast origin. */
  date: string;
  /** Date the outcome became known (origin + horizon sessions). */
  labelDate: string;
  /** σ(origin, h): forecast standard deviation of the h-day log return. */
  sigma: number;
  logReturn: number;
  z: number;
}

export interface ForecastShape {
  horizonDays: number;
  /** Ascending standardised outcomes; a normal quantile grid when history is too short. */
  sortedZ: number[];
  samples: number;
  trainedThrough: string | null;
  method: "empirical" | "normal";
}

export interface ForecastConePoint {
  day: number;
  date: string;
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface ForecastProbability {
  key: string;
  label: string;
  /** Signed simple-return threshold (0.05 = a gain of at least 5%). */
  threshold: number;
  probability: number;
}

export type VolatilityCondition = "subdued" | "normal" | "elevated";

export interface AssetForecast {
  horizonDays: number;
  asOf: string;
  lastClose: number;
  probabilityUp: number;
  volatility: {
    dailyNow: number;
    dailyLongRun: number;
    annualisedNow: number;
    annualisedLongRun: number;
    /** Standard deviation of the horizon log return. */
    horizon: number;
    condition: VolatilityCondition;
  };
  /** Simple-return quantiles and mean at the horizon. */
  returns: { p05: number; p25: number; p50: number; p75: number; p95: number; mean: number };
  cone: ForecastConePoint[];
  probabilities: ForecastProbability[];
  /** 5th-percentile simple return (a loss is negative). */
  valueAtRisk95: number;
  /** Mean simple return in the worst 5% of outcomes. */
  expectedShortfall95: number;
  method: ForecastShape["method"];
  shapeSamples: number;
}

export interface ForecastEvaluation {
  predictions: number;
  evaluationStart: string | null;
  evaluationEnd: string | null;
  /** Share of realised outcomes inside the 5–95% band (target 90%). */
  coverage90: number | null;
  /** Share inside the 25–75% band (target 50%). */
  coverage50: number | null;
  /** Probability integral transform histogram: 10 equal bins, shares (uniform = 0.1 each). */
  pitHistogram: number[];
  /** Mean width of the 90% band in simple-return terms (sharpness). */
  averageBandWidth90: number | null;
}

// ─── Volatility ──────────────────────────────────────────────────────────────────────────────

/** σ²(t, h) under the mean-reverting term structure. */
export function horizonVariance(
  state: VolatilityState,
  horizon: number,
  persistence = VOLATILITY_PERSISTENCE,
): number {
  const decay = persistence === 1 ? horizon : (1 - persistence ** horizon) / (1 - persistence);
  return Math.max(horizon * state.longRun + (state.ewma - state.longRun) * decay, 1e-12);
}

/** Causal volatility state per bar (null during warm-up), aligned with `bars`. */
export function volatilityStates(bars: readonly PriceBar[]): (VolatilityState | null)[] {
  const out: (VolatilityState | null)[] = new Array(bars.length).fill(null);
  if (bars.length < 2) return out;
  const returns: number[] = [];
  for (let t = 1; t < bars.length; t++) {
    returns.push(Math.log((bars[t] as PriceBar).close / (bars[t - 1] as PriceBar).close));
  }
  const ewma = ewmaVariance(returns, EWMA_LAMBDA);
  let sumSquares = 0;
  for (let j = 0; j < returns.length; j++) {
    sumSquares += (returns[j] as number) ** 2;
    if (j >= LONG_RUN_WINDOW) sumSquares -= (returns[j - LONG_RUN_WINDOW] as number) ** 2;
    const count = Math.min(j + 1, LONG_RUN_WINDOW);
    const v = ewma[j];
    if (v === null || v === undefined || count < LONG_RUN_MIN_RETURNS) continue;
    out[j + 1] = { ewma: v, longRun: Math.max(sumSquares / count, 1e-12) };
  }
  return out;
}

function condition(state: VolatilityState): VolatilityCondition {
  const ratio = Math.sqrt(state.ewma / state.longRun);
  if (ratio >= 1.25) return "elevated";
  if (ratio <= 0.8) return "subdued";
  return "normal";
}

// ─── Shape ───────────────────────────────────────────────────────────────────────────────────

/** Standardised h-day outcomes for one asset (origins whose window is complete). */
export function buildForecastSamples(
  symbol: string,
  bars: readonly PriceBar[],
  states: readonly (VolatilityState | null)[],
  horizonDays: number,
): ForecastSample[] {
  const samples: ForecastSample[] = [];
  for (let s = 0; s + horizonDays < bars.length; s++) {
    const state = states[s];
    if (!state) continue;
    const origin = bars[s] as PriceBar;
    const outcome = bars[s + horizonDays] as PriceBar;
    const sigma = Math.sqrt(horizonVariance(state, horizonDays));
    const logReturn = Math.log(outcome.close / origin.close);
    samples.push({
      symbol,
      date: origin.date,
      labelDate: outcome.date,
      sigma,
      logReturn,
      z: logReturn / sigma,
    });
  }
  return samples;
}

const NORMAL_GRID: number[] = Array.from({ length: NORMAL_GRID_SIZE }, (_, i) =>
  normalQuantile((i + 0.5) / NORMAL_GRID_SIZE),
);

/** Pooled shape from every outcome known by `asOfDate`. */
export function fitForecastShape(
  samples: readonly ForecastSample[],
  asOfDate: string,
  horizonDays: number,
): ForecastShape {
  const known: number[] = [];
  let trainedThrough: string | null = null;
  for (const sample of samples) {
    if (sample.labelDate > asOfDate) continue;
    known.push(sample.z);
    if (trainedThrough === null || sample.labelDate > trainedThrough) {
      trainedThrough = sample.labelDate;
    }
  }
  if (known.length < MIN_SHAPE_SAMPLES) {
    return {
      horizonDays,
      sortedZ: NORMAL_GRID,
      samples: known.length,
      trainedThrough,
      method: "normal",
    };
  }
  return {
    horizonDays,
    sortedZ: known.sort((a, b) => a - b),
    samples: known.length,
    trainedThrough,
    method: "empirical",
  };
}

/** Location of the h-day log return so that P(return > 0) = probabilityUp. */
export function calibratedLocation(
  shape: ForecastShape,
  sigma: number,
  probabilityUp: number,
): number {
  return -sigma * quantileSorted(shape.sortedZ, 1 - probabilityUp);
}

/** P(simple return at the horizon > threshold). */
function probabilityAbove(
  shape: ForecastShape,
  location: number,
  sigma: number,
  threshold: number,
) {
  return shareAbove(shape.sortedZ, (Math.log(1 + threshold) - location) / sigma);
}

// ─── Forecast ────────────────────────────────────────────────────────────────────────────────

function percentLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function forecastAsset(input: {
  bars: readonly PriceBar[];
  states: readonly (VolatilityState | null)[];
  shape: ForecastShape;
  probabilityUp: number;
  calendar?: TradingCalendar;
}): AssetForecast | null {
  const { bars, states, shape, probabilityUp } = input;
  const horizonDays = shape.horizonDays;
  const last = bars[bars.length - 1];
  const state = states[bars.length - 1];
  if (!last || !state) return null;

  const sigma = Math.sqrt(horizonVariance(state, horizonDays));
  const location = calibratedLocation(shape, sigma, probabilityUp);
  const dates = nextTradingDays(input.calendar ?? WEEKDAY_CALENDAR, last.date, horizonDays);
  const z = FORECAST_QUANTILES.map((q) => quantileSorted(shape.sortedZ, q));

  const cone: ForecastConePoint[] = [
    {
      day: 0,
      date: last.date,
      p05: last.close,
      p25: last.close,
      p50: last.close,
      p75: last.close,
      p95: last.close,
    },
  ];
  for (let day = 1; day <= horizonDays; day++) {
    const scale = Math.sqrt(horizonVariance(state, day));
    const drift = (location * day) / horizonDays;
    const price = (zq: number) => round(last.close * Math.exp(drift + scale * zq), 4);
    cone.push({
      day,
      date: dates[day - 1] as string,
      p05: price(z[0] as number),
      p25: price(z[1] as number),
      p50: price(z[2] as number),
      p75: price(z[3] as number),
      p95: price(z[4] as number),
    });
  }

  const simple = (zq: number) => Math.exp(location + sigma * zq) - 1;
  const outcomes = shape.sortedZ.map(simple);
  const tailCut = quantileSorted(shape.sortedZ, 0.05);
  const tail = shape.sortedZ.filter((value) => value <= tailCut).map(simple);

  const probabilities: ForecastProbability[] = [];
  for (const threshold of [...FORECAST_THRESHOLDS].reverse()) {
    probabilities.push({
      key: `gain-${threshold}`,
      label: `Gain of ${percentLabel(threshold)} or more`,
      threshold,
      probability: round(probabilityAbove(shape, location, sigma, threshold), 4),
    });
  }
  probabilities.push({
    key: "positive",
    label: "Any gain",
    threshold: 0,
    probability: round(probabilityAbove(shape, location, sigma, 0), 4),
  });
  for (const threshold of FORECAST_THRESHOLDS) {
    probabilities.push({
      key: `loss-${threshold}`,
      label: `Loss of ${percentLabel(threshold)} or more`,
      threshold: -threshold,
      probability: round(1 - probabilityAbove(shape, location, sigma, -threshold), 4),
    });
  }

  return {
    horizonDays,
    asOf: last.date,
    lastClose: last.close,
    probabilityUp: round(probabilityUp, 4),
    volatility: {
      dailyNow: round(Math.sqrt(state.ewma), 6),
      dailyLongRun: round(Math.sqrt(state.longRun), 6),
      annualisedNow: round(Math.sqrt(state.ewma * TRADING_DAYS_PER_YEAR), 4),
      annualisedLongRun: round(Math.sqrt(state.longRun * TRADING_DAYS_PER_YEAR), 4),
      horizon: round(sigma, 6),
      condition: condition(state),
    },
    returns: {
      p05: round(simple(z[0] as number), 6),
      p25: round(simple(z[1] as number), 6),
      p50: round(simple(z[2] as number), 6),
      p75: round(simple(z[3] as number), 6),
      p95: round(simple(z[4] as number), 6),
      mean: round(mean(outcomes), 6),
    },
    cone,
    probabilities,
    valueAtRisk95: round(simple(tailCut), 6),
    expectedShortfall95: round(tail.length > 0 ? mean(tail) : simple(tailCut), 6),
    method: shape.method,
    shapeSamples: shape.samples,
  };
}

// ─── Walk-forward evaluation ─────────────────────────────────────────────────────────────────

const EMPTY_EVALUATION: ForecastEvaluation = {
  predictions: 0,
  evaluationStart: null,
  evaluationEnd: null,
  coverage90: null,
  coverage50: null,
  pitHistogram: new Array(10).fill(0),
  averageBandWidth90: null,
};

/**
 * Out-of-sample check of the whole distribution. The calibration model and the shape are
 * refitted every `refitEvery` origin dates using only outcomes known at the refit date; each
 * forecast is then scored against its realised outcome through the probability integral
 * transform (PIT = forecast P(return ≤ realised)). A calibrated distribution has uniform PITs,
 * ~90% of outcomes inside the 5–95% band and ~50% inside the 25–75% band.
 */
export function walkForwardForecastEvaluation(
  calibrationSamples: readonly CalibrationSample[],
  forecastSamples: readonly ForecastSample[],
  options: { horizonDays: number; refitEvery?: number; minCalibrationSamples?: number },
): ForecastEvaluation {
  const { horizonDays, refitEvery = 21, minCalibrationSamples = 1_000 } = options;
  const scores = new Map(
    calibrationSamples.map((sample) => [`${sample.symbol}|${sample.date}`, sample.score]),
  );
  const joined = forecastSamples
    .filter((sample) => scores.has(`${sample.symbol}|${sample.date}`))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (joined.length === 0)
    return { ...EMPTY_EVALUATION, pitHistogram: [...EMPTY_EVALUATION.pitHistogram] };

  const histogram = new Array(10).fill(0) as number[];
  let predictions = 0;
  let inside90 = 0;
  let inside50 = 0;
  let widthSum = 0;
  let start: string | null = null;
  let end: string | null = null;

  let calibration: CalibrationModel | null = null;
  let shape: ForecastShape | null = null;
  let datesSinceRefit = refitEvery;
  let currentDate = "";

  for (const sample of joined) {
    if (sample.date !== currentDate) {
      currentDate = sample.date;
      if (datesSinceRefit >= refitEvery || !calibration || !shape) {
        const candidate = fitCalibrationModel(calibrationSamples, currentDate, horizonDays);
        const candidateShape = fitForecastShape(forecastSamples, currentDate, horizonDays);
        if (candidate.samples >= minCalibrationSamples && candidateShape.method === "empirical") {
          calibration = candidate;
          shape = candidateShape;
          datesSinceRefit = 0;
        }
      }
      if (calibration && shape) datesSinceRefit += 1;
    }
    if (!calibration || !shape) continue;

    const score = scores.get(`${sample.symbol}|${sample.date}`) as number;
    const location = calibratedLocation(
      shape,
      sample.sigma,
      calibratedProbability(calibration, score),
    );
    const pit = 1 - shareAbove(shape.sortedZ, (sample.logReturn - location) / sample.sigma);
    predictions += 1;
    histogram[Math.min(9, Math.floor(pit * 10))] += 1;
    if (pit >= 0.05 && pit <= 0.95) inside90 += 1;
    if (pit >= 0.25 && pit <= 0.75) inside50 += 1;
    const lower = quantileSorted(shape.sortedZ, 0.05);
    const upper = quantileSorted(shape.sortedZ, 0.95);
    widthSum +=
      Math.exp(location + sample.sigma * upper) - Math.exp(location + sample.sigma * lower);
    start ??= sample.date;
    end = sample.date;
  }

  if (predictions === 0) return { ...EMPTY_EVALUATION, pitHistogram: histogram };
  return {
    predictions,
    evaluationStart: start,
    evaluationEnd: end,
    coverage90: round(inside90 / predictions, 4),
    coverage50: round(inside50 / predictions, 4),
    pitHistogram: histogram.map((count) => round(count / predictions, 4)),
    averageBandWidth90: round(widthSum / predictions, 4),
  };
}
