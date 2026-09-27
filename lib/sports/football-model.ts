import { riskLevelFromScore } from "@/lib/risk-levels";
import {
  buildScoreMatrix,
  cleanSheetProbabilities,
  normalisedEntropy,
  outcomeProbabilities,
  probabilityBothTeamsScore,
  probabilityTotalOver,
  topScorelines,
} from "@/lib/sports/poisson";
import type {
  FormResult,
  InjuryLevel,
  LambdaFactor,
  MatchModelInputs,
  MatchOutcome,
  MatchPrediction,
  TeamModelInputs,
} from "@/lib/sports/types";
import { clamp, round } from "@/lib/quant/stats";

/**
 * Esocity football model (model key: sports.poisson-dixon-coles).
 *
 *   λ_home = baseline × √HA × attack*_home × defence*_away × form_home
 *            × injuryAttack_home × injuryDefence_away × rest_home × restDefence_away
 *   λ_away = baseline ÷ √HA × attack*_away × defence*_home × form_away
 *            × injuryAttack_away × injuryDefence_home × rest_away × restDefence_home
 *
 * Home advantage HA is the ratio of home to away expected goals between equal teams; splitting
 * it symmetrically keeps `baseline` equal to the league-average goals per team per match (the
 * same parameterisation used by lib/sports/ratings.ts).
 *
 * attack* / defence* blend the long-run rating (75%) with recent xG relative to the league
 * baseline (25%). Every multiplier is returned in `factors` so the UI can show the full
 * derivation of each expected-goals figure.
 */

export const FOOTBALL_MODEL_VERSION = "2.1.0";
export const DEFAULT_RHO = -0.06;
export const DEFAULT_MAX_GOALS = 6;

const RATING_WEIGHT = 0.75;
const XG_WEIGHT = 0.25;
const FORM_WEIGHTS = [0.1, 0.15, 0.2, 0.25, 0.3]; // oldest → most recent (last five)
const FORM_POINTS: Record<FormResult, number> = { W: 3, D: 1, L: 0 };
const LEAGUE_AVERAGE_PPG = 1.4;

export const INJURY_ATTACK_FACTOR: Record<InjuryLevel, number> = {
  none: 1,
  minor: 0.98,
  moderate: 0.95,
  major: 0.9,
};

/** Applied to the OPPONENT's expected goals (a depleted defence concedes more). */
export const INJURY_DEFENCE_FACTOR: Record<InjuryLevel, number> = {
  none: 1,
  minor: 1.01,
  moderate: 1.03,
  major: 1.06,
};

/** Weighted points-per-game over the last five results (most recent weighted highest). */
export function formPointsPerGame(form: readonly FormResult[] | undefined): number | null {
  if (!form || form.length === 0) return null;
  const recent = form.slice(-FORM_WEIGHTS.length);
  const weights = FORM_WEIGHTS.slice(FORM_WEIGHTS.length - recent.length);
  let weighted = 0;
  let totalWeight = 0;
  recent.forEach((result, i) => {
    const weight = weights[i] as number;
    weighted += weight * FORM_POINTS[result];
    totalWeight += weight;
  });
  return weighted / totalWeight;
}

/** Form multiplier: ±6% per point-per-game away from the league average, capped at ±8%. */
export function formModifier(form: readonly FormResult[] | undefined): number {
  const ppg = formPointsPerGame(form);
  if (ppg === null) return 1;
  return clamp(1 + 0.06 * (ppg - LEAGUE_AVERAGE_PPG), 0.92, 1.08);
}

/** Fatigue: short turnarounds reduce attacking output; long rest is neutral-to-slightly-positive. */
export function restModifier(restDays: number | undefined): number {
  if (restDays === undefined) return 1;
  if (restDays <= 2) return 0.94;
  if (restDays === 3) return 0.97;
  if (restDays >= 7) return 1.01;
  return 1;
}

function blendedAttack(team: TeamModelInputs, baseline: number): number {
  if (team.xgFor === undefined || team.xgFor <= 0) return team.attack;
  return RATING_WEIGHT * team.attack + XG_WEIGHT * (team.xgFor / baseline);
}

function blendedDefence(team: TeamModelInputs, baseline: number): number {
  if (team.xgAgainst === undefined || team.xgAgainst <= 0) return team.defence;
  return RATING_WEIGHT * team.defence + XG_WEIGHT * (team.xgAgainst / baseline);
}

/** Share of optional inputs that are present (lineup uncertainty lowers quality). */
export function dataQuality(inputs: MatchModelInputs): number {
  let score = 1;
  for (const team of [inputs.home, inputs.away]) {
    if (!team.form || team.form.length < 3) score -= 0.1;
    if (team.xgFor === undefined || team.xgAgainst === undefined) score -= 0.1;
    if (team.restDays === undefined) score -= 0.05;
    if (team.injuries === "moderate") score -= 0.05;
    if (team.injuries === "major") score -= 0.1;
  }
  return clamp(round(score, 3), 0, 1);
}

export interface LambdaBreakdown {
  lambdaHome: number;
  lambdaAway: number;
  factors: LambdaFactor[];
}

export function computeExpectedGoals(inputs: MatchModelInputs): LambdaBreakdown {
  const { home, away, leagueBaselineGoals: baseline, homeAdvantage } = inputs;
  if (!(baseline > 0) || !(homeAdvantage > 0)) {
    throw new Error("League baseline goals and home advantage must be positive");
  }
  if (!(home.attack > 0 && home.defence > 0 && away.attack > 0 && away.defence > 0)) {
    throw new Error("Attack and defence ratings must be positive");
  }

  const attackHome = blendedAttack(home, baseline);
  const attackAway = blendedAttack(away, baseline);
  const defenceHome = blendedDefence(home, baseline);
  const defenceAway = blendedDefence(away, baseline);
  const formHome = formModifier(home.form);
  const formAway = formModifier(away.form);
  const injuryHome = home.injuries ?? "none";
  const injuryAway = away.injuries ?? "none";
  const restHome = restModifier(home.restDays);
  const restAway = restModifier(away.restDays);
  // Fatigue also loosens a side's defence, at half the attacking effect.
  const restDefenceHome = 1 + (1 - restHome) / 2;
  const restDefenceAway = 1 + (1 - restAway) / 2;

  const factors: LambdaFactor[] = [
    {
      key: "baseline",
      label: "League baseline",
      home: baseline,
      away: baseline,
      description: "League-average goals per team per match.",
    },
    {
      key: "home_advantage",
      label: "Home advantage",
      home: Math.sqrt(homeAdvantage),
      away: 1 / Math.sqrt(homeAdvantage),
      description: `Home/away goal ratio of ${homeAdvantage.toFixed(2)} between equal teams, split symmetrically.`,
    },
    {
      key: "attack",
      label: "Attack (rating + xG)",
      home: attackHome,
      away: attackAway,
      description: "75% long-run attack rating, 25% recent xG relative to the baseline.",
    },
    {
      key: "opponent_defence",
      label: "Opponent defence",
      home: defenceAway,
      away: defenceHome,
      description: "Opponent's defence rating blended with recent xG conceded (lower is stronger).",
    },
    {
      key: "form",
      label: "Form (last five)",
      home: formHome,
      away: formAway,
      description: "±6% per point-per-game versus league average, capped at ±8%.",
    },
    {
      key: "injuries",
      label: "Availability",
      home: INJURY_ATTACK_FACTOR[injuryHome] * INJURY_DEFENCE_FACTOR[injuryAway],
      away: INJURY_ATTACK_FACTOR[injuryAway] * INJURY_DEFENCE_FACTOR[injuryHome],
      description: "Own attacking absences reduce output; opponent defensive absences increase it.",
    },
    {
      key: "rest",
      label: "Rest / fatigue",
      home: restHome * restDefenceAway,
      away: restAway * restDefenceHome,
      description: "Short turnarounds (≤3 days) reduce attack and loosen defence.",
    },
  ];

  const product = (side: "home" | "away") =>
    factors.reduce((accumulator, factor) => accumulator * factor[side], 1);

  return {
    lambdaHome: clamp(product("home"), 0.15, 5),
    lambdaAway: clamp(product("away"), 0.15, 5),
    factors: factors.map((factor) => ({
      ...factor,
      home: round(factor.home, 4),
      away: round(factor.away, 4),
    })),
  };
}

function mostLikely(outcome: { home: number; draw: number; away: number }): MatchOutcome {
  if (outcome.home >= outcome.draw && outcome.home >= outcome.away) return "HOME";
  if (outcome.away >= outcome.draw) return "AWAY";
  return "DRAW";
}

/**
 * Model confidence in [0, 0.9]: how concentrated the 1X2 distribution is (1 − normalised
 * entropy), adjusted for input completeness. Football is inherently uncertain — a near coin-flip
 * scores ~0.4 and even heavy favourites stay below the 0.9 cap.
 */
export function computeMatchConfidence(entropy: number, quality: number): number {
  const decisiveness = 1 - entropy;
  return clamp(round((0.35 + 1.6 * decisiveness) * (0.85 + 0.15 * quality), 3), 0, 0.9);
}

/** Entropy → uncertainty score knots: [normalised entropy, score]. Published thresholds. */
const UNCERTAINTY_KNOTS: [number, number][] = [
  [0.8, 0],
  [0.88, 25],
  [0.96, 50],
  [0.99, 75],
  [1, 100],
];

/**
 * Uncertainty score (0–100) from outcome entropy, plus up to 10 points for incomplete inputs.
 * Bands: <25 Low · 25–49 Moderate · 50–74 High · ≥75 Very high.
 */
export function computeUncertaintyScore(entropy: number, quality: number): number {
  let base = 0;
  if (entropy >= 1) base = 100;
  else if (entropy > (UNCERTAINTY_KNOTS[0] as [number, number])[0]) {
    for (let i = 1; i < UNCERTAINTY_KNOTS.length; i++) {
      const [x0, y0] = UNCERTAINTY_KNOTS[i - 1] as [number, number];
      const [x1, y1] = UNCERTAINTY_KNOTS[i] as [number, number];
      if (entropy <= x1) {
        base = y0 + ((entropy - x0) / (x1 - x0)) * (y1 - y0);
        break;
      }
    }
  }
  return clamp(Math.round(base + 10 * (1 - quality)), 0, 100);
}

export function predictMatch(inputs: MatchModelInputs): MatchPrediction {
  const maxGoals = inputs.maxGoals ?? DEFAULT_MAX_GOALS;
  const { lambdaHome, lambdaAway, factors } = computeExpectedGoals(inputs);
  const matrix = buildScoreMatrix(lambdaHome, lambdaAway, {
    maxGoals,
    rho: inputs.rho ?? DEFAULT_RHO,
  });
  const outcome = outcomeProbabilities(matrix);
  const over15 = probabilityTotalOver(matrix, 1.5);
  const over25 = probabilityTotalOver(matrix, 2.5);
  const over35 = probabilityTotalOver(matrix, 3.5);
  const btts = probabilityBothTeamsScore(matrix);
  const cleanSheets = cleanSheetProbabilities(matrix);
  const entropy = normalisedEntropy([outcome.home, outcome.draw, outcome.away]);
  const quality = dataQuality(inputs);

  return {
    modelVersion: FOOTBALL_MODEL_VERSION,
    lambdaHome: round(lambdaHome, 4),
    lambdaAway: round(lambdaAway, 4),
    maxGoals,
    rho: round(matrix.rho, 4),
    scoreMatrix: matrix.probabilities,
    truncatedMass: matrix.truncatedMass,
    outcome,
    mostLikelyOutcome: mostLikely(outcome),
    markets: {
      over15,
      over25,
      over35,
      under15: 1 - over15,
      under25: 1 - over25,
      under35: 1 - over35,
      bttsYes: btts,
      bttsNo: 1 - btts,
      cleanSheetHome: cleanSheets.home,
      cleanSheetAway: cleanSheets.away,
    },
    topScorelines: topScorelines(matrix, 5),
    outcomeEntropy: round(entropy, 4),
    dataQuality: quality,
    confidence: computeMatchConfidence(entropy, quality),
    uncertainty: riskLevelFromScore(computeUncertaintyScore(entropy, quality)),
    factors,
  };
}
