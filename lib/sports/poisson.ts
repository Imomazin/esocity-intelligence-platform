/**
 * Poisson score model primitives (with optional Dixon–Coles low-score correction).
 *
 * Goals for each side are modelled as Poisson(λ). Independence is relaxed for the four
 * low-scoring cells (0-0, 1-0, 0-1, 1-1) by the Dixon & Coles (1997) τ adjustment, which is
 * mass-preserving. The matrix is truncated at `maxGoals` per side and renormalised so that every
 * derived probability sums exactly to 1; the truncated tail mass is reported for transparency.
 */

export interface ScoreMatrix {
  maxGoals: number;
  /** probabilities[h][a] = P(home scores h, away scores a), normalised to sum to 1. */
  probabilities: number[][];
  /** Probability mass beyond maxGoals that was removed before renormalisation. */
  truncatedMass: number;
  rho: number;
}

export interface OutcomeProbabilities {
  home: number;
  draw: number;
  away: number;
}

export interface Scoreline {
  home: number;
  away: number;
  probability: number;
}

/** P(X = k) for X ~ Poisson(λ), computed iteratively for numerical stability. */
export function poissonPmf(k: number, lambda: number): number {
  if (!Number.isInteger(k) || k < 0) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let probability = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) probability *= lambda / i;
  return probability;
}

/** [P(0), …, P(maxGoals)] for Poisson(λ). */
export function poissonDistribution(lambda: number, maxGoals: number): number[] {
  return Array.from({ length: maxGoals + 1 }, (_, k) => poissonPmf(k, lambda));
}

/** Dixon–Coles τ correction factor for a scoreline. */
export function dixonColesTau(
  homeGoals: number,
  awayGoals: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number,
): number {
  if (homeGoals === 0 && awayGoals === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lambdaHome * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + lambdaAway * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

/** Clamp ρ to the range where every τ stays non-negative (a valid probability model). */
export function clampRho(rho: number, lambdaHome: number, lambdaAway: number): number {
  const lower = Math.max(-1 / lambdaHome, -1 / lambdaAway);
  const upper = Math.min(1 / (lambdaHome * lambdaAway), 1);
  return Math.min(upper, Math.max(lower, rho));
}

export function buildScoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  options: { maxGoals?: number; rho?: number } = {},
): ScoreMatrix {
  const maxGoals = options.maxGoals ?? 6;
  if (!(lambdaHome > 0) || !(lambdaAway > 0)) {
    throw new Error("Expected goals (λ) must be positive");
  }
  const rho = clampRho(options.rho ?? 0, lambdaHome, lambdaAway);
  const home = poissonDistribution(lambdaHome, maxGoals);
  const away = poissonDistribution(lambdaAway, maxGoals);

  const raw: number[][] = [];
  let captured = 0;
  for (let h = 0; h <= maxGoals; h++) {
    const row: number[] = [];
    for (let a = 0; a <= maxGoals; a++) {
      const p =
        (home[h] as number) *
        (away[a] as number) *
        dixonColesTau(h, a, lambdaHome, lambdaAway, rho);
      row.push(p);
      captured += p;
    }
    raw.push(row);
  }

  return {
    maxGoals,
    rho,
    truncatedMass: Math.max(0, 1 - captured),
    probabilities: raw.map((row) => row.map((p) => p / captured)),
  };
}

export function outcomeProbabilities(matrix: ScoreMatrix): OutcomeProbabilities {
  let home = 0;
  let draw = 0;
  let away = 0;
  matrix.probabilities.forEach((row, h) =>
    row.forEach((p, a) => {
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }),
  );
  return { home, draw, away };
}

/** P(total goals > line), e.g. line 2.5 → over 2.5 goals. */
export function probabilityTotalOver(matrix: ScoreMatrix, line: number): number {
  let total = 0;
  matrix.probabilities.forEach((row, h) =>
    row.forEach((p, a) => {
      if (h + a > line) total += p;
    }),
  );
  return total;
}

export function probabilityBothTeamsScore(matrix: ScoreMatrix): number {
  let total = 0;
  matrix.probabilities.forEach((row, h) =>
    row.forEach((p, a) => {
      if (h > 0 && a > 0) total += p;
    }),
  );
  return total;
}

/** Clean-sheet probabilities: home keeps a clean sheet when the away side scores 0. */
export function cleanSheetProbabilities(matrix: ScoreMatrix): { home: number; away: number } {
  let homeCleanSheet = 0;
  let awayCleanSheet = 0;
  matrix.probabilities.forEach((row, h) =>
    row.forEach((p, a) => {
      if (a === 0) homeCleanSheet += p;
      if (h === 0) awayCleanSheet += p;
    }),
  );
  return { home: homeCleanSheet, away: awayCleanSheet };
}

export function topScorelines(matrix: ScoreMatrix, count = 5): Scoreline[] {
  const cells: Scoreline[] = [];
  matrix.probabilities.forEach((row, h) =>
    row.forEach((p, a) => cells.push({ home: h, away: a, probability: p })),
  );
  return cells
    .sort((x, y) => y.probability - x.probability || x.home + x.away - (y.home + y.away))
    .slice(0, count);
}

/** Normalise non-negative weights to a probability vector (sums to exactly 1). */
export function normaliseProbabilities(values: readonly number[]): number[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return values.map(() => 1 / values.length);
  return values.map((value) => Math.max(0, value) / total);
}

/** Shannon entropy of a discrete distribution, normalised to [0, 1] by log(n). */
export function normalisedEntropy(probabilities: readonly number[]): number {
  const n = probabilities.length;
  if (n <= 1) return 0;
  let entropy = 0;
  for (const p of probabilities) {
    if (p > 0) entropy -= p * Math.log(p);
  }
  return entropy / Math.log(n);
}
