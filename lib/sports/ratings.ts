import { mean } from "@/lib/quant/stats";

/**
 * Team rating estimation from results (Maher-style multiplicative Poisson model).
 *
 *   E[home goals] = μ · h · attack_home · defence_away
 *   E[away goals] = μ ·     attack_away · defence_home
 *
 * Solved by iterative proportional fitting with a Gamma–Poisson (conjugate) prior: each team
 * starts with `priorWeight` pseudo-matches at its prior rating, so early-season estimates shrink
 * toward pre-season priors and converge to the data as results accumulate.
 */

export interface ResultInput {
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
}

export interface LeagueParameters {
  /** μ — average goals per team per match (away-side baseline). */
  baselineGoals: number;
  /** h — home multiplier. */
  homeAdvantage: number;
  matches: number;
}

export interface TeamRating {
  attack: number;
  defence: number;
  matches: number;
}

export interface RatingPrior {
  attack: number;
  defence: number;
}

/**
 * League baseline and home advantage with pseudo-match priors. Home advantage is empirically
 * stable across seasons, so it gets a much stronger prior than the scoring rate — a hundred
 * matches is far too few to overturn it.
 */
export function estimateLeagueParameters(
  results: readonly ResultInput[],
  prior: {
    baselineGoals: number;
    homeAdvantage: number;
    baselineWeight?: number;
    homeAdvantageWeight?: number;
  },
): LeagueParameters {
  const baselineWeight = prior.baselineWeight ?? 40;
  const homeAdvantageWeight = prior.homeAdvantageWeight ?? 200;
  const n = results.length;
  const homeGoals = results.reduce((total, r) => total + r.homeGoals, 0);
  const awayGoals = results.reduce((total, r) => total + r.awayGoals, 0);

  const sqrtPriorHa = Math.sqrt(prior.homeAdvantage);
  const priorHomeRate = prior.baselineGoals * sqrtPriorHa;
  const priorAwayRate = prior.baselineGoals / sqrtPriorHa;

  const homeRate = (homeGoals + homeAdvantageWeight * priorHomeRate) / (n + homeAdvantageWeight);
  const awayRate = (awayGoals + homeAdvantageWeight * priorAwayRate) / (n + homeAdvantageWeight);
  const homeAdvantage = homeRate / awayRate;

  // Arithmetic goals per team per match, then converted to the geometric baseline b such that
  // home = b·√h and away = b/√h reproduce it.
  const priorPerTeam = (priorHomeRate + priorAwayRate) / 2;
  const perTeam =
    (homeGoals + awayGoals + 2 * baselineWeight * priorPerTeam) / (2 * (n + baselineWeight));
  const sqrtHa = Math.sqrt(homeAdvantage);
  return {
    baselineGoals: (2 * perTeam) / (sqrtHa + 1 / sqrtHa),
    homeAdvantage,
    matches: n,
  };
}

export function estimateTeamRatings(
  teams: readonly string[],
  results: readonly ResultInput[],
  league: LeagueParameters,
  priors: Readonly<Record<string, RatingPrior>>,
  options: { priorWeight?: number; iterations?: number } = {},
): Record<string, TeamRating> {
  const priorWeight = options.priorWeight ?? 6;
  const iterations = options.iterations ?? 40;
  // Home/away baselines consistent with the multiplicative form (geometric split of h).
  const muHome = league.baselineGoals * Math.sqrt(league.homeAdvantage);
  const muAway = league.baselineGoals / Math.sqrt(league.homeAdvantage);
  const perMatchExpectation = (muHome + muAway) / 2;

  const attack: Record<string, number> = {};
  const defence: Record<string, number> = {};
  const played: Record<string, number> = {};
  for (const team of teams) {
    attack[team] = priors[team]?.attack ?? 1;
    defence[team] = priors[team]?.defence ?? 1;
    played[team] = 0;
  }
  for (const result of results) {
    played[result.homeTeam] = (played[result.homeTeam] ?? 0) + 1;
    played[result.awayTeam] = (played[result.awayTeam] ?? 0) + 1;
  }

  for (let iteration = 0; iteration < iterations; iteration++) {
    const scored: Record<string, number> = {};
    const scoredExpectation: Record<string, number> = {};
    for (const team of teams) {
      scored[team] = 0;
      scoredExpectation[team] = 0;
    }
    for (const r of results) {
      scored[r.homeTeam] = (scored[r.homeTeam] ?? 0) + r.homeGoals;
      scored[r.awayTeam] = (scored[r.awayTeam] ?? 0) + r.awayGoals;
      scoredExpectation[r.homeTeam] =
        (scoredExpectation[r.homeTeam] ?? 0) + muHome * (defence[r.awayTeam] ?? 1);
      scoredExpectation[r.awayTeam] =
        (scoredExpectation[r.awayTeam] ?? 0) + muAway * (defence[r.homeTeam] ?? 1);
    }
    for (const team of teams) {
      const priorAttack = priors[team]?.attack ?? 1;
      attack[team] =
        ((scored[team] ?? 0) + priorWeight * perMatchExpectation * priorAttack) /
        ((scoredExpectation[team] ?? 0) + priorWeight * perMatchExpectation);
    }

    const conceded: Record<string, number> = {};
    const concededExpectation: Record<string, number> = {};
    for (const team of teams) {
      conceded[team] = 0;
      concededExpectation[team] = 0;
    }
    for (const r of results) {
      conceded[r.homeTeam] = (conceded[r.homeTeam] ?? 0) + r.awayGoals;
      conceded[r.awayTeam] = (conceded[r.awayTeam] ?? 0) + r.homeGoals;
      concededExpectation[r.homeTeam] =
        (concededExpectation[r.homeTeam] ?? 0) + muAway * (attack[r.awayTeam] ?? 1);
      concededExpectation[r.awayTeam] =
        (concededExpectation[r.awayTeam] ?? 0) + muHome * (attack[r.homeTeam] ?? 1);
    }
    for (const team of teams) {
      const priorDefence = priors[team]?.defence ?? 1;
      defence[team] =
        ((conceded[team] ?? 0) + priorWeight * perMatchExpectation * priorDefence) /
        ((concededExpectation[team] ?? 0) + priorWeight * perMatchExpectation);
    }

    // Identifiability: keep the average team at 1.0 for both ratings.
    const attackMean = mean(teams.map((team) => attack[team] ?? 1));
    const defenceMean = mean(teams.map((team) => defence[team] ?? 1));
    for (const team of teams) {
      attack[team] = (attack[team] ?? 1) / attackMean;
      defence[team] = (defence[team] ?? 1) / defenceMean;
    }
  }

  return Object.fromEntries(
    teams.map((team) => [
      team,
      { attack: attack[team] ?? 1, defence: defence[team] ?? 1, matches: played[team] ?? 0 },
    ]),
  );
}
