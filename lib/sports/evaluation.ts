import { mean, round, wilsonInterval } from "@/lib/quant/stats";
import { predictMatch } from "@/lib/sports/football-model";
import type { Match, MatchOutcome, MatchPrediction } from "@/lib/sports/types";

/**
 * Out-of-sample evaluation of the football model on finished matches. Each prediction uses the
 * match's pre-match `modelInputs` (built from earlier rounds only), so these are genuine
 * forecasts, not in-sample fits.
 */

/** Typical top-flight base rates, used as the naive comparison forecast. */
export const BASELINE_OUTCOME_RATES = { home: 0.45, draw: 0.26, away: 0.29 } as const;
export const BASELINE_OVER25_RATE = 0.52;

export interface EvaluatedMatch {
  match: Match;
  prediction: MatchPrediction;
  actual: MatchOutcome;
  correct: boolean;
  brier: number;
  rps: number;
}

export interface OutcomeReliabilityBin {
  lower: number;
  upper: number;
  count: number;
  meanPredicted: number | null;
  observedFrequency: number | null;
  /** 95% Wilson interval of the observed frequency. */
  observedLower: number | null;
  observedUpper: number | null;
}

export interface SportsEvaluation {
  matches: number;
  accuracy: number | null;
  brierScore: number | null;
  baselineBrierScore: number | null;
  brierSkillScore: number | null;
  logLoss: number | null;
  /** Ranked probability score — respects the order home < draw < away; lower is better. */
  rps: number | null;
  baselineRps: number | null;
  over25Brier: number | null;
  over25BaselineBrier: number | null;
  bttsBrier: number | null;
  averageConfidence: number | null;
  reliability: OutcomeReliabilityBin[];
  recent: EvaluatedMatch[];
}

const RELIABILITY_EDGES = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 1];

export function actualOutcome(home: number, away: number): MatchOutcome {
  if (home > away) return "HOME";
  if (home === away) return "DRAW";
  return "AWAY";
}

/**
 * Ranked probability score for the ordered outcomes HOME < DRAW < AWAY:
 *   RPS = ½ · Σ_{k=1..2} (F_k − O_k)²  with F, O the cumulative forecast and outcome.
 * Unlike the Brier score it rewards putting probability NEAR the result (a draw forecast is
 * less wrong for a narrow away win than a home-win forecast). Range [0, 1].
 */
export function rankedProbabilityScore(
  probabilities: { home: number; draw: number; away: number },
  actual: MatchOutcome,
): number {
  const f1 = probabilities.home;
  const f2 = probabilities.home + probabilities.draw;
  const o1 = actual === "HOME" ? 1 : 0;
  const o2 = actual === "AWAY" ? 0 : 1;
  return ((f1 - o1) ** 2 + (f2 - o2) ** 2) / 2;
}

/** Multi-class Brier score: Σ over outcomes of (p − y)², range [0, 2]. */
export function multiclassBrier(
  probabilities: { home: number; draw: number; away: number },
  actual: MatchOutcome,
): number {
  const y = {
    home: actual === "HOME" ? 1 : 0,
    draw: actual === "DRAW" ? 1 : 0,
    away: actual === "AWAY" ? 1 : 0,
  };
  return (
    (probabilities.home - y.home) ** 2 +
    (probabilities.draw - y.draw) ** 2 +
    (probabilities.away - y.away) ** 2
  );
}

export function evaluateSportsModel(
  finishedMatches: readonly Match[],
  recentCount = 12,
): SportsEvaluation {
  const evaluated: EvaluatedMatch[] = [];
  for (const match of finishedMatches) {
    if (match.status !== "finished" || !match.score) continue;
    const prediction = predictMatch(match.modelInputs);
    const actual = actualOutcome(match.score.home, match.score.away);
    evaluated.push({
      match,
      prediction,
      actual,
      correct: prediction.mostLikelyOutcome === actual,
      brier: multiclassBrier(prediction.outcome, actual),
      rps: rankedProbabilityScore(prediction.outcome, actual),
    });
  }

  const reliability: OutcomeReliabilityBin[] = RELIABILITY_EDGES.slice(0, -1).map((lower, i) => ({
    lower,
    upper: RELIABILITY_EDGES[i + 1] as number,
    count: 0,
    meanPredicted: null,
    observedFrequency: null,
    observedLower: null,
    observedUpper: null,
  }));

  if (evaluated.length === 0) {
    return {
      matches: 0,
      accuracy: null,
      brierScore: null,
      baselineBrierScore: null,
      brierSkillScore: null,
      logLoss: null,
      rps: null,
      baselineRps: null,
      over25Brier: null,
      over25BaselineBrier: null,
      bttsBrier: null,
      averageConfidence: null,
      reliability,
      recent: [],
    };
  }

  const accumulators = reliability.map(() => ({ predicted: 0, observed: 0, count: 0 }));
  for (const { prediction, actual } of evaluated) {
    const pairs: [number, boolean][] = [
      [prediction.outcome.home, actual === "HOME"],
      [prediction.outcome.draw, actual === "DRAW"],
      [prediction.outcome.away, actual === "AWAY"],
    ];
    for (const [p, hit] of pairs) {
      const index = RELIABILITY_EDGES.findIndex(
        (edge, i) =>
          i < RELIABILITY_EDGES.length - 1 && p >= edge && p < (RELIABILITY_EDGES[i + 1] as number),
      );
      const accumulator = accumulators[index === -1 ? accumulators.length - 1 : index];
      if (!accumulator) continue;
      accumulator.predicted += p;
      accumulator.observed += hit ? 1 : 0;
      accumulator.count += 1;
    }
  }
  accumulators.forEach((accumulator, i) => {
    const bin = reliability[i];
    if (!bin || accumulator.count === 0) return;
    bin.count = accumulator.count;
    bin.meanPredicted = round(accumulator.predicted / accumulator.count, 4);
    bin.observedFrequency = round(accumulator.observed / accumulator.count, 4);
    const interval = wilsonInterval(accumulator.observed, accumulator.count);
    bin.observedLower = round(interval.lower, 4);
    bin.observedUpper = round(interval.upper, 4);
  });

  const brier = mean(evaluated.map((entry) => entry.brier));
  const baseline = mean(
    evaluated.map((entry) => multiclassBrier(BASELINE_OUTCOME_RATES, entry.actual)),
  );
  const logLoss = mean(
    evaluated.map(({ prediction, actual }) => {
      const p =
        actual === "HOME"
          ? prediction.outcome.home
          : actual === "DRAW"
            ? prediction.outcome.draw
            : prediction.outcome.away;
      return -Math.log(Math.max(p, 1e-9));
    }),
  );
  const over25Brier = mean(
    evaluated.map(({ prediction, match }) => {
      const over = (match.score?.home ?? 0) + (match.score?.away ?? 0) > 2.5 ? 1 : 0;
      return (prediction.markets.over25 - over) ** 2;
    }),
  );
  const over25Baseline = mean(
    evaluated.map(({ match }) => {
      const over = (match.score?.home ?? 0) + (match.score?.away ?? 0) > 2.5 ? 1 : 0;
      return (BASELINE_OVER25_RATE - over) ** 2;
    }),
  );
  const bttsBrier = mean(
    evaluated.map(({ prediction, match }) => {
      const btts = (match.score?.home ?? 0) > 0 && (match.score?.away ?? 0) > 0 ? 1 : 0;
      return (prediction.markets.bttsYes - btts) ** 2;
    }),
  );

  const recent = [...evaluated]
    .sort((a, b) => b.match.kickoffAt.localeCompare(a.match.kickoffAt))
    .slice(0, recentCount);

  return {
    matches: evaluated.length,
    accuracy: round(evaluated.filter((entry) => entry.correct).length / evaluated.length, 4),
    brierScore: round(brier, 4),
    baselineBrierScore: round(baseline, 4),
    brierSkillScore: baseline > 0 ? round(1 - brier / baseline, 4) : null,
    logLoss: round(logLoss, 4),
    rps: round(mean(evaluated.map((entry) => entry.rps)), 4),
    baselineRps: round(
      mean(evaluated.map((entry) => rankedProbabilityScore(BASELINE_OUTCOME_RATES, entry.actual))),
      4,
    ),
    over25Brier: round(over25Brier, 4),
    over25BaselineBrier: round(over25Baseline, 4),
    bttsBrier: round(bttsBrier, 4),
    averageConfidence: round(mean(evaluated.map((entry) => entry.prediction.confidence)), 4),
    reliability,
    recent,
  };
}
