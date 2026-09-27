import type { RiskLevel } from "@/lib/risk-levels";
import type { OutcomeProbabilities, Scoreline } from "@/lib/sports/poisson";

export type FormResult = "W" | "D" | "L";
export type InjuryLevel = "none" | "minor" | "moderate" | "major";
export type MatchStatus = "scheduled" | "live" | "finished" | "postponed" | "cancelled";
export type MatchOutcome = "HOME" | "DRAW" | "AWAY";

export interface Sport {
  key: string;
  name: string;
}

export interface Competition {
  key: string;
  sportKey: string;
  name: string;
  shortName: string;
  region: string;
  season: string;
  baselineGoals: number;
  homeAdvantage: number;
  teamCount: number;
}

export interface Team {
  key: string;
  name: string;
  shortName: string;
  code: string;
  city: string;
  venue: string;
  competitionKey: string;
}

/** Inputs for one side of the football model. */
export interface TeamModelInputs {
  /** Multiplicative attack rating (1.0 = league average; higher scores more). */
  attack: number;
  /** Multiplicative defence rating (1.0 = league average; LOWER concedes less). */
  defence: number;
  /** Recent results, oldest → most recent. */
  form?: FormResult[];
  /** Recent average expected goals for / against per match. */
  xgFor?: number;
  xgAgainst?: number;
  injuries?: InjuryLevel;
  /** Days since the previous competitive match. */
  restDays?: number;
}

export interface MatchModelInputs {
  home: TeamModelInputs;
  away: TeamModelInputs;
  /** League-average goals per team per match. */
  leagueBaselineGoals: number;
  /** Ratio of home to away expected goals between equal teams (split as √HA / 1÷√HA). */
  homeAdvantage: number;
  /** Dixon–Coles low-score dependence parameter (typically slightly negative). */
  rho?: number;
  maxGoals?: number;
}

export interface LambdaFactor {
  key: string;
  label: string;
  home: number;
  away: number;
  description: string;
}

export interface GoalMarkets {
  over15: number;
  over25: number;
  over35: number;
  under15: number;
  under25: number;
  under35: number;
  bttsYes: number;
  bttsNo: number;
  cleanSheetHome: number;
  cleanSheetAway: number;
}

export interface MatchPrediction {
  modelVersion: string;
  lambdaHome: number;
  lambdaAway: number;
  maxGoals: number;
  rho: number;
  scoreMatrix: number[][];
  truncatedMass: number;
  outcome: OutcomeProbabilities;
  mostLikelyOutcome: MatchOutcome;
  markets: GoalMarkets;
  topScorelines: Scoreline[];
  /** Normalised Shannon entropy of the 1X2 distribution (1 = maximally uncertain). */
  outcomeEntropy: number;
  dataQuality: number;
  confidence: number;
  uncertainty: RiskLevel;
  factors: LambdaFactor[];
}

export interface TeamMatchContext {
  teamKey: string;
  form: FormResult[];
  xgFor: number | null;
  xgAgainst: number | null;
  injuries: InjuryLevel;
  restDays: number | null;
  attackRating: number;
  defenceRating: number;
  leaguePosition: number | null;
}

export interface Match {
  id: string;
  competitionKey: string;
  round: number;
  kickoffAt: string;
  status: MatchStatus;
  venue: string;
  homeTeam: Team;
  awayTeam: Team;
  score: { home: number; away: number } | null;
  /** Realised expected goals (finished matches only). */
  xg: { home: number; away: number } | null;
  context: { home: TeamMatchContext; away: TeamMatchContext };
  /** Pre-match model inputs, built only from information available before kick-off. */
  modelInputs: MatchModelInputs;
}

export interface StandingRow {
  position: number;
  team: Team;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: FormResult[];
}
