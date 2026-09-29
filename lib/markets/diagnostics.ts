import type { CalibrationSample } from "@/lib/markets/calibration";
import { SIGNAL_THRESHOLDS } from "@/lib/markets/signal-engine";
import { mean, quantileSorted, round, wilsonInterval } from "@/lib/quant/stats";

/**
 * Descriptive diagnostics for the composite signal: what followed each band of composite
 * scores. The score has no fitted parameters (weights and thresholds are published constants),
 * so these are genuine historical outcomes, not in-sample fits — but overlapping horizon windows
 * make neighbouring samples highly dependent, so the intervals are optimistic.
 */

export interface ScoreBucket {
  key: string;
  label: string;
  lower: number;
  upper: number;
  count: number;
  hitRate: number | null;
  hitRateLower: number | null;
  hitRateUpper: number | null;
  meanForwardReturn: number | null;
  medianForwardReturn: number | null;
}

export interface ScoreBucketAnalysis {
  horizonDays: number;
  buckets: ScoreBucket[];
  /** True when the hit rate never falls as the score rises (buckets with data only). */
  monotonic: boolean;
  /** Hit rate of the strongest band minus the weakest (percentage points as a ratio). */
  spread: number | null;
  baseRate: number | null;
}

const WEAK = 0.1;

const signed = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;

export const SCORE_BANDS = [
  {
    key: "strong-sell",
    label: `≤ ${signed(SIGNAL_THRESHOLDS.sell)}`,
    lower: -1,
    upper: SIGNAL_THRESHOLDS.sell,
  },
  {
    key: "lean-sell",
    label: `${signed(SIGNAL_THRESHOLDS.sell)} to ${signed(-WEAK)}`,
    lower: SIGNAL_THRESHOLDS.sell,
    upper: -WEAK,
  },
  { key: "neutral", label: `${signed(-WEAK)} to ${signed(WEAK)}`, lower: -WEAK, upper: WEAK },
  {
    key: "lean-buy",
    label: `${signed(WEAK)} to ${signed(SIGNAL_THRESHOLDS.buy)}`,
    lower: WEAK,
    upper: SIGNAL_THRESHOLDS.buy,
  },
  {
    key: "strong-buy",
    label: `≥ ${signed(SIGNAL_THRESHOLDS.buy)}`,
    lower: SIGNAL_THRESHOLDS.buy,
    upper: 1,
  },
] as const;

function bandIndex(score: number): number {
  if (score <= SIGNAL_THRESHOLDS.sell) return 0;
  if (score < -WEAK) return 1;
  if (score <= WEAK) return 2;
  if (score < SIGNAL_THRESHOLDS.buy) return 3;
  return 4;
}

export function scoreBucketAnalysis(
  samples: readonly CalibrationSample[],
  horizonDays: number,
): ScoreBucketAnalysis {
  const returns: number[][] = SCORE_BANDS.map(() => []);
  for (const sample of samples)
    (returns[bandIndex(sample.score)] as number[]).push(sample.forwardReturn);

  const buckets: ScoreBucket[] = SCORE_BANDS.map((band, i) => {
    const values = (returns[i] as number[]).sort((a, b) => a - b);
    const hits = values.filter((value) => value > 0).length;
    const interval = values.length > 0 ? wilsonInterval(hits, values.length) : null;
    return {
      key: band.key,
      label: band.label,
      lower: band.lower,
      upper: band.upper,
      count: values.length,
      hitRate: values.length > 0 ? round(hits / values.length, 4) : null,
      hitRateLower: interval ? round(interval.lower, 4) : null,
      hitRateUpper: interval ? round(interval.upper, 4) : null,
      meanForwardReturn: values.length > 0 ? round(mean(values), 6) : null,
      medianForwardReturn: values.length > 0 ? round(quantileSorted(values, 0.5), 6) : null,
    };
  });

  const populated = buckets.filter((bucket) => bucket.hitRate !== null);
  const monotonic = populated.every(
    (bucket, i) => i === 0 || (bucket.hitRate as number) >= (populated[i - 1]?.hitRate as number),
  );
  const first = populated[0];
  const last = populated[populated.length - 1];
  const all = samples.length;
  return {
    horizonDays,
    buckets,
    monotonic,
    spread:
      first && last && first !== last
        ? round((last.hitRate as number) - (first.hitRate as number), 4)
        : null,
    baseRate:
      all > 0 ? round(samples.filter((sample) => sample.outcome === 1).length / all, 4) : null,
  };
}
