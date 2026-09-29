import type { FeatureRow, PriceBar } from "@/lib/markets/types";
import {
  clamp,
  mean,
  quantileSorted,
  round,
  stdDev,
  TRADING_DAYS_PER_YEAR,
  wilsonInterval,
} from "@/lib/quant/stats";

/**
 * Historical analogs (model key: markets.historical-analogs).
 *
 * "When the technical picture looked like this before, what happened next?" Each bar is
 * described by six causal features, standardised across the candidate pool. The k nearest past
 * setups (Euclidean distance, any asset in the universe) whose forward window had already
 * completed by the query date are the analogs; their realised h-day outcomes form an empirical
 * distribution that complements the composite signal.
 *
 * Guards against the usual failure modes:
 *   • no look-ahead — a candidate is eligible only once its outcome is known (labelDate ≤ as-of);
 *   • no near-duplicates — analogs from the same asset must be ≥ 10 sessions apart, so one
 *     persistent episode cannot masquerade as many independent observations;
 *   • honest evaluation — the analog P(up) is scored walk-forward against the base rate.
 */

export const ANALOG_MODEL_VERSION = "1.0.0";
export const ANALOG_COUNT = 25;
export const ANALOG_SEPARATION = 10;
const ONE_YEAR = 252;
const MIN_POOL = 400;

export const ANALOG_FEATURES = [
  { key: "trend", label: "Trend score" },
  { key: "momentum", label: "Momentum score" },
  { key: "rsi", label: "RSI (14)" },
  { key: "volatility", label: "Volatility percentile" },
  { key: "fromHigh", label: "Distance from 1-year high" },
  { key: "shortTerm", label: "5-day move (vol-adjusted)" },
] as const;

export type AnalogFeatureKey = (typeof ANALOG_FEATURES)[number]["key"];

export interface AnalogInput {
  symbol: string;
  bars: readonly PriceBar[];
  features: readonly FeatureRow[];
}

interface Candidate {
  symbol: string;
  index: number;
  date: string;
  labelDate: string;
  vector: number[];
  forwardReturn: number;
}

export interface AnalogUniverse {
  horizonDays: number;
  /** Every setup with a complete forward window, ascending by label date. */
  candidates: Candidate[];
  /** positives[i] = number of positive outcomes among candidates[0…i−1]. */
  positives: number[];
  inputs: Map<string, AnalogInput>;
}

export interface Analog {
  symbol: string;
  date: string;
  similarity: number;
  forwardReturn: number;
  /** Cumulative simple return for day 0…h after the setup. */
  path: number[];
}

export interface AnalogSummary {
  count: number;
  hitRate: number;
  hitRateLower: number;
  hitRateUpper: number;
  meanReturn: number;
  medianReturn: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  /** Unconditional share of positive h-day outcomes in the eligible pool. */
  baseRate: number;
  baseMedianReturn: number;
}

export interface AnalogResult {
  symbol: string;
  asOf: string;
  horizonDays: number;
  poolSize: number;
  features: { key: AnalogFeatureKey; label: string; value: number; zScore: number }[];
  analogs: Analog[];
  summary: AnalogSummary;
  /** Median and interquartile cumulative return by day across the analogs. */
  pathBands: { day: number; p25: number; p50: number; p75: number }[];
}

export interface AnalogEvaluation {
  predictions: number;
  evaluationStart: string | null;
  evaluationEnd: string | null;
  brierScore: number | null;
  baselineBrierScore: number | null;
  brierSkillScore: number | null;
  /** Hit rate of the analog majority call where it leaned ≥ 55/45. */
  directionalHitRate: number | null;
  directionalCalls: number;
}

// ─── Features ────────────────────────────────────────────────────────────────────────────────

/** Causal feature vector for bar `index` (null during warm-up). */
export function analogFeatureVector(
  bars: readonly PriceBar[],
  rows: readonly FeatureRow[],
  index: number,
): number[] | null {
  const row = rows[index];
  if (!row?.scores || row.rsi14 === null || row.volatilityPercentile === null) return null;
  if (row.volatility20 === null || index < 5) return null;
  let high = Number.NEGATIVE_INFINITY;
  for (let i = Math.max(0, index - ONE_YEAR + 1); i <= index; i++) {
    high = Math.max(high, (bars[i] as PriceBar).close);
  }
  const close = (bars[index] as PriceBar).close;
  const fiveDay = close / (bars[index - 5] as PriceBar).close - 1;
  const fiveDaySigma = Math.max(row.volatility20, 0.05) * Math.sqrt(5 / TRADING_DAYS_PER_YEAR);
  return [
    row.scores.trend,
    row.scores.momentum,
    row.rsi14 / 100,
    row.volatilityPercentile,
    close / high - 1,
    clamp(fiveDay / fiveDaySigma, -4, 4),
  ];
}

export function buildAnalogUniverse(
  inputs: readonly AnalogInput[],
  horizonDays: number,
): AnalogUniverse {
  const candidates: Candidate[] = [];
  for (const input of inputs) {
    for (let index = 0; index + horizonDays < input.bars.length; index++) {
      const vector = analogFeatureVector(input.bars, input.features, index);
      if (!vector) continue;
      const origin = input.bars[index] as PriceBar;
      const outcome = input.bars[index + horizonDays] as PriceBar;
      candidates.push({
        symbol: input.symbol,
        index,
        date: origin.date,
        labelDate: outcome.date,
        vector,
        forwardReturn: outcome.close / origin.close - 1,
      });
    }
  }
  candidates.sort((a, b) => a.labelDate.localeCompare(b.labelDate));
  const positives = [0];
  for (const candidate of candidates) {
    positives.push(
      (positives[positives.length - 1] as number) + (candidate.forwardReturn > 0 ? 1 : 0),
    );
  }
  return {
    horizonDays,
    candidates,
    positives,
    inputs: new Map(inputs.map((input) => [input.symbol, input])),
  };
}

// ─── Search ──────────────────────────────────────────────────────────────────────────────────

interface Scaler {
  means: number[];
  sds: number[];
}

function fitScaler(pool: readonly Candidate[]): Scaler {
  const dims = ANALOG_FEATURES.length;
  const means: number[] = [];
  const sds: number[] = [];
  for (let d = 0; d < dims; d++) {
    const column = pool.map((candidate) => candidate.vector[d] as number);
    means.push(mean(column));
    const sd = stdDev(column);
    sds.push(Number.isFinite(sd) && sd > 1e-9 ? sd : 1);
  }
  return { means, sds };
}

function standardise(vector: readonly number[], scaler: Scaler): number[] {
  return vector.map(
    (value, d) => (value - (scaler.means[d] as number)) / (scaler.sds[d] as number),
  );
}

/** Number of candidates whose label is known by `asOfDate` (candidates are label-sorted). */
function eligibleCount(candidates: readonly Candidate[], asOfDate: string): number {
  let lo = 0;
  let hi = candidates.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((candidates[mid] as Candidate).labelDate <= asOfDate) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Neighbour {
  candidate: Candidate;
  distance: number;
}

const SHORTLIST = 160;

function distanceTo(candidate: Candidate, query: readonly number[], scaler: Scaler): number {
  let squared = 0;
  for (let d = 0; d < query.length; d++) {
    const value =
      ((candidate.vector[d] as number) - (scaler.means[d] as number)) / (scaler.sds[d] as number);
    squared += (value - (query[d] as number)) ** 2;
  }
  return Math.sqrt(squared);
}

/** Greedy pick in distance order, skipping setups too close in time to an analog already taken. */
function pickSeparated(sorted: readonly Neighbour[], k: number, separation: number): Neighbour[] {
  const chosen: Neighbour[] = [];
  const taken = new Map<string, number[]>();
  for (const entry of sorted) {
    const indices = taken.get(entry.candidate.symbol) ?? [];
    if (indices.some((index) => Math.abs(index - entry.candidate.index) < separation)) continue;
    indices.push(entry.candidate.index);
    taken.set(entry.candidate.symbol, indices);
    chosen.push(entry);
    if (chosen.length >= k) break;
  }
  return chosen;
}

function nearest(
  pool: readonly Candidate[],
  query: readonly number[],
  scaler: Scaler,
  k: number,
  separation: number,
): Neighbour[] {
  const standardisedQuery = standardise(query, scaler);
  // Keep a sorted shortlist of the closest setups instead of sorting the whole pool.
  const shortlist: Neighbour[] = [];
  for (const candidate of pool) {
    const distance = distanceTo(candidate, standardisedQuery, scaler);
    if (
      shortlist.length === SHORTLIST &&
      distance >= (shortlist[SHORTLIST - 1] as Neighbour).distance
    ) {
      continue;
    }
    let lo = 0;
    let hi = shortlist.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((shortlist[mid] as Neighbour).distance <= distance) lo = mid + 1;
      else hi = mid;
    }
    shortlist.splice(lo, 0, { candidate, distance });
    if (shortlist.length > SHORTLIST) shortlist.pop();
  }
  const chosen = pickSeparated(shortlist, k, separation);
  if (chosen.length >= k || shortlist.length < SHORTLIST) return chosen;
  // Rare: one long episode crowds the shortlist — fall back to a full ranking.
  const all = pool
    .map((candidate) => ({ candidate, distance: distanceTo(candidate, standardisedQuery, scaler) }))
    .sort((a, b) => a.distance - b.distance);
  return pickSeparated(all, k, separation);
}

function cumulativePath(bars: readonly PriceBar[], index: number, horizonDays: number): number[] {
  const origin = (bars[index] as PriceBar).close;
  return Array.from({ length: horizonDays + 1 }, (_, day) =>
    round((bars[index + day] as PriceBar).close / origin - 1, 6),
  );
}

/** Nearest past setups for the bar `index` of `symbol` (default: its latest bar). */
export function findAnalogs(
  universe: AnalogUniverse,
  symbol: string,
  options: { index?: number; k?: number; separation?: number } = {},
): AnalogResult | null {
  const input = universe.inputs.get(symbol);
  if (!input) return null;
  const index = options.index ?? input.bars.length - 1;
  const query = analogFeatureVector(input.bars, input.features, index);
  const asOf = input.bars[index]?.date;
  if (!query || !asOf) return null;

  const pool = universe.candidates.slice(0, eligibleCount(universe.candidates, asOf));
  if (pool.length < MIN_POOL) return null;
  const scaler = fitScaler(pool);
  const neighbours = nearest(
    pool,
    query,
    scaler,
    options.k ?? ANALOG_COUNT,
    options.separation ?? ANALOG_SEPARATION,
  );
  const dims = ANALOG_FEATURES.length;

  const analogs: Analog[] = neighbours.map(({ candidate, distance }) => ({
    symbol: candidate.symbol,
    date: candidate.date,
    similarity: round(Math.exp(-(distance * distance) / (2 * dims)), 4),
    forwardReturn: round(candidate.forwardReturn, 6),
    path: cumulativePath(
      (universe.inputs.get(candidate.symbol) as AnalogInput).bars,
      candidate.index,
      universe.horizonDays,
    ),
  }));

  const outcomes = analogs.map((analog) => analog.forwardReturn).sort((a, b) => a - b);
  const hits = outcomes.filter((value) => value > 0).length;
  const interval = wilsonInterval(hits, outcomes.length);
  const poolOutcomes = pool.map((candidate) => candidate.forwardReturn).sort((a, b) => a - b);

  const pathBands = Array.from({ length: universe.horizonDays + 1 }, (_, day) => {
    const values = analogs.map((analog) => analog.path[day] as number).sort((a, b) => a - b);
    return {
      day,
      p25: round(quantileSorted(values, 0.25), 6),
      p50: round(quantileSorted(values, 0.5), 6),
      p75: round(quantileSorted(values, 0.75), 6),
    };
  });

  const standardisedQuery = standardise(query, scaler);
  return {
    symbol,
    asOf,
    horizonDays: universe.horizonDays,
    poolSize: pool.length,
    features: ANALOG_FEATURES.map((feature, d) => ({
      key: feature.key,
      label: feature.label,
      value: round(query[d] as number, 4),
      zScore: round(standardisedQuery[d] as number, 3),
    })),
    analogs,
    summary: {
      count: outcomes.length,
      hitRate: round(hits / Math.max(outcomes.length, 1), 4),
      hitRateLower: round(interval.lower, 4),
      hitRateUpper: round(interval.upper, 4),
      meanReturn: round(mean(outcomes), 6),
      medianReturn: round(quantileSorted(outcomes, 0.5), 6),
      p10: round(quantileSorted(outcomes, 0.1), 6),
      p25: round(quantileSorted(outcomes, 0.25), 6),
      p75: round(quantileSorted(outcomes, 0.75), 6),
      p90: round(quantileSorted(outcomes, 0.9), 6),
      baseRate: round(poolOutcomes.filter((value) => value > 0).length / poolOutcomes.length, 4),
      baseMedianReturn: round(quantileSorted(poolOutcomes, 0.5), 6),
    },
    pathBands,
  };
}

// ─── Walk-forward evaluation ─────────────────────────────────────────────────────────────────

/**
 * Score the analog P(up) = (hits + 1) / (k + 2) out of sample: every `step` sessions per asset,
 * search only the pool known at that date (standardisation refitted every `refitEvery` distinct
 * query dates) and compare with the realised outcome. The baseline forecast is the pool's base
 * rate at the same date.
 */
export function walkForwardAnalogEvaluation(
  universe: AnalogUniverse,
  options: { step?: number; refitEvery?: number; k?: number } = {},
): AnalogEvaluation {
  const { step = 10, refitEvery = 21, k = ANALOG_COUNT } = options;
  const queries = universe.candidates
    .filter((candidate) => candidate.index % step === 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  let predictions = 0;
  let brier = 0;
  let baseline = 0;
  let calls = 0;
  let callHits = 0;
  let start: string | null = null;
  let end: string | null = null;
  let scaler: Scaler | null = null;
  let scalerDate = "";
  let datesSinceRefit = refitEvery;

  for (const query of queries) {
    const poolSize = eligibleCount(universe.candidates, query.date);
    if (poolSize < MIN_POOL) continue;
    const pool = universe.candidates.slice(0, poolSize);
    if (query.date !== scalerDate) {
      scalerDate = query.date;
      datesSinceRefit += 1;
      if (!scaler || datesSinceRefit >= refitEvery) {
        scaler = fitScaler(pool);
        datesSinceRefit = 0;
      }
    }
    const neighbours = nearest(pool, query.vector, scaler as Scaler, k, ANALOG_SEPARATION);
    if (neighbours.length < k) continue;
    const hits = neighbours.filter(({ candidate }) => candidate.forwardReturn > 0).length;
    const probability = (hits + 1) / (neighbours.length + 2);
    const baseRate = (universe.positives[poolSize] as number) / poolSize;
    const outcome = query.forwardReturn > 0 ? 1 : 0;
    predictions += 1;
    brier += (probability - outcome) ** 2;
    baseline += (baseRate - outcome) ** 2;
    if (probability >= 0.55 || probability <= 0.45) {
      calls += 1;
      if ((probability >= 0.55 ? 1 : 0) === outcome) callHits += 1;
    }
    start ??= query.date;
    end = query.date;
  }

  if (predictions === 0) {
    return {
      predictions: 0,
      evaluationStart: null,
      evaluationEnd: null,
      brierScore: null,
      baselineBrierScore: null,
      brierSkillScore: null,
      directionalHitRate: null,
      directionalCalls: 0,
    };
  }
  const brierScore = brier / predictions;
  const baselineBrierScore = baseline / predictions;
  return {
    predictions,
    evaluationStart: start,
    evaluationEnd: end,
    brierScore: round(brierScore, 5),
    baselineBrierScore: round(baselineBrierScore, 5),
    brierSkillScore: baselineBrierScore > 0 ? round(1 - brierScore / baselineBrierScore, 4) : null,
    directionalHitRate: calls > 0 ? round(callHits / calls, 4) : null,
    directionalCalls: calls,
  };
}
