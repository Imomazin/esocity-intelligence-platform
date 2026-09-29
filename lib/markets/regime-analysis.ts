import type { FeatureRow, MarketRegime } from "@/lib/markets/types";
import { mean, quantileSorted, round, wilsonInterval } from "@/lib/quant/stats";

/**
 * Regime dynamics on top of the rule-based classifier (lib/markets/regime.ts): how long regimes
 * last, how likely they are to persist over the signal horizon, and what followed each regime
 * historically. Transition counts use only pairs whose later date is known by the as-of date.
 */

/** Display order: constructive → neutral → defensive → stressed. */
export const REGIME_ORDER: readonly MarketRegime[] = [
  "UPTREND",
  "RANGE_BOUND",
  "DOWNTREND",
  "HIGH_VOLATILITY",
];

export interface RegimeSegment {
  regime: MarketRegime;
  startDate: string;
  endDate: string;
  sessions: number;
  /** False for the run still in progress at the end of the data. */
  completed: boolean;
}

export interface RegimeTransitionMatrix {
  horizonDays: number;
  regimes: readonly MarketRegime[];
  /** counts[from][to] of (regime at t, regime at t + h) pairs. */
  counts: number[][];
  /** Row-normalised counts; a row with no observations is all zeros. */
  probabilities: number[][];
  totals: number[];
  samples: number;
}

export interface RegimeProfile {
  regime: MarketRegime;
  /** Share of classified sessions spent in the regime. */
  share: number;
  /** Mean length of completed runs, in sessions. */
  averageDuration: number | null;
  samples: number;
  meanForwardReturn: number | null;
  medianForwardReturn: number | null;
  hitRate: number | null;
  hitRateLower: number | null;
  hitRateUpper: number | null;
}

export interface RegimeStatus {
  regime: MarketRegime;
  since: string;
  /** Sessions the current run has lasted (including today). */
  sessions: number;
  /** Historical P(same regime h sessions later | regime now). */
  persistence: number | null;
  averageDuration: number | null;
  /** Most likely regime h sessions later, with its probability. */
  mostLikelyNext: { regime: MarketRegime; probability: number } | null;
}

export interface RegimeRows {
  rows: readonly FeatureRow[];
}

const indexOf = (regime: MarketRegime) => REGIME_ORDER.indexOf(regime);

/** Contiguous runs of the same regime (warm-up rows without a regime are skipped). */
export function regimeSegments(rows: readonly FeatureRow[]): RegimeSegment[] {
  const segments: RegimeSegment[] = [];
  let current: RegimeSegment | null = null;
  for (const row of rows) {
    if (!row.regime) continue;
    if (current && current.regime === row.regime) {
      current.endDate = row.date;
      current.sessions += 1;
      continue;
    }
    if (current) segments.push(current);
    current = {
      regime: row.regime,
      startDate: row.date,
      endDate: row.date,
      sessions: 1,
      completed: true,
    };
  }
  if (current) segments.push({ ...current, completed: false });
  return segments;
}

export function regimeTransitionMatrix(
  inputs: readonly RegimeRows[],
  horizonDays: number,
  asOfDate?: string,
): RegimeTransitionMatrix {
  const size = REGIME_ORDER.length;
  const counts = Array.from({ length: size }, () => new Array(size).fill(0) as number[]);
  for (const { rows } of inputs) {
    for (let s = 0; s + horizonDays < rows.length; s++) {
      const from = rows[s]?.regime;
      const later = rows[s + horizonDays];
      if (!from || !later?.regime) continue;
      if (asOfDate && later.date > asOfDate) continue;
      (counts[indexOf(from)] as number[])[indexOf(later.regime)] += 1;
    }
  }
  const totals = counts.map((row) => row.reduce((total, count) => total + count, 0));
  return {
    horizonDays,
    regimes: REGIME_ORDER,
    counts,
    probabilities: counts.map((row, i) =>
      row.map((count) => ((totals[i] as number) > 0 ? round(count / (totals[i] as number), 4) : 0)),
    ),
    totals,
    samples: totals.reduce((total, count) => total + count, 0),
  };
}

export function regimeProfiles(
  inputs: readonly RegimeRows[],
  horizonDays: number,
): RegimeProfile[] {
  const sessions = new Map<MarketRegime, number>();
  const durations = new Map<MarketRegime, number[]>();
  const outcomes = new Map<MarketRegime, number[]>();
  let classified = 0;

  for (const { rows } of inputs) {
    for (const segment of regimeSegments(rows)) {
      if (!segment.completed) continue;
      durations.set(segment.regime, [...(durations.get(segment.regime) ?? []), segment.sessions]);
    }
    for (let s = 0; s < rows.length; s++) {
      const row = rows[s] as FeatureRow;
      if (!row.regime) continue;
      classified += 1;
      sessions.set(row.regime, (sessions.get(row.regime) ?? 0) + 1);
      const later = rows[s + horizonDays];
      if (!later) continue;
      const list = outcomes.get(row.regime) ?? [];
      list.push(later.close / row.close - 1);
      outcomes.set(row.regime, list);
    }
  }

  return REGIME_ORDER.map((regime) => {
    const returns = (outcomes.get(regime) ?? []).sort((a, b) => a - b);
    const runs = durations.get(regime) ?? [];
    const hits = returns.filter((value) => value > 0).length;
    const interval = returns.length > 0 ? wilsonInterval(hits, returns.length) : null;
    return {
      regime,
      share: classified > 0 ? round((sessions.get(regime) ?? 0) / classified, 4) : 0,
      averageDuration: runs.length > 0 ? round(mean(runs), 1) : null,
      samples: returns.length,
      meanForwardReturn: returns.length > 0 ? round(mean(returns), 6) : null,
      medianForwardReturn: returns.length > 0 ? round(quantileSorted(returns, 0.5), 6) : null,
      hitRate: returns.length > 0 ? round(hits / returns.length, 4) : null,
      hitRateLower: interval ? round(interval.lower, 4) : null,
      hitRateUpper: interval ? round(interval.upper, 4) : null,
    };
  });
}

export function regimeStatus(
  rows: readonly FeatureRow[],
  matrix: RegimeTransitionMatrix,
  profiles: readonly RegimeProfile[],
): RegimeStatus | null {
  const segments = regimeSegments(rows);
  const current = segments[segments.length - 1];
  if (!current) return null;
  const row = matrix.probabilities[indexOf(current.regime)] as number[];
  const total = matrix.totals[indexOf(current.regime)] as number;
  let best: { regime: MarketRegime; probability: number } | null = null;
  for (let j = 0; total > 0 && j < row.length; j++) {
    const probability = row[j] as number;
    if (best === null || probability > best.probability) {
      best = { regime: REGIME_ORDER[j] as MarketRegime, probability };
    }
  }
  return {
    regime: current.regime,
    since: current.startDate,
    sessions: current.sessions,
    persistence: total > 0 ? (row[indexOf(current.regime)] as number) : null,
    averageDuration:
      profiles.find((profile) => profile.regime === current.regime)?.averageDuration ?? null,
    mostLikelyNext: best,
  };
}
