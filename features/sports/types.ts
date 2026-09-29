import type { EngineInfo } from "@/lib/ml/engine";
import type { RiskLevel } from "@/lib/risk-levels";
import type { SportsEvaluation } from "@/lib/sports/evaluation";
import type {
  Competition,
  Match,
  MatchOutcome,
  MatchPrediction,
  MatchStatus,
  StandingRow,
  TeamMatchContext,
} from "@/lib/sports/types";

export interface TeamRef {
  key: string;
  name: string;
  shortName: string;
  code: string;
}

export interface PredictionSummary {
  home: number;
  draw: number;
  away: number;
  lambdaHome: number;
  lambdaAway: number;
  over25: number;
  btts: number;
  confidence: number;
  uncertainty: RiskLevel;
  mostLikelyOutcome: MatchOutcome;
  topScoreline: { home: number; away: number; probability: number } | null;
}

export interface MatchSummary {
  id: string;
  competition: { key: string; name: string; shortName: string };
  round: number;
  kickoffAt: string;
  status: MatchStatus;
  venue: string;
  home: TeamRef;
  away: TeamRef;
  score: { home: number; away: number } | null;
  prediction: PredictionSummary;
  /** For finished matches: did the most likely outcome occur? */
  outcomeCorrect: boolean | null;
}

export interface SportsOverview {
  provider: { id: string; displayName: string; isSimulated: boolean };
  competitions: Competition[];
  upcoming: MatchSummary[];
  recent: MatchSummary[];
  live: MatchSummary[];
  standings: { competition: Competition; rows: StandingRow[] }[];
  evaluation: Omit<SportsEvaluation, "recent">;
}

export interface MatchDetail {
  match: Match;
  provider: { id: string; displayName: string; isSimulated: boolean };
  competition: Competition;
  prediction: MatchPrediction;
  engine: EngineInfo;
  context: { home: TeamMatchContext; away: TeamMatchContext };
  previousMeeting: MatchSummary | null;
  outcomeCorrect: boolean | null;
}
