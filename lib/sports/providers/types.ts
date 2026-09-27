import type { Competition, Match, MatchStatus, Sport, StandingRow, Team } from "@/lib/sports/types";

/**
 * Sports data provider contract. Providers supply fixtures, results and pre-match model inputs
 * (ratings, form, availability, rest). The probability model is separate (lib/sports/
 * football-model.ts) so any provider's data can feed any engine — local TypeScript or the
 * Python ML service.
 *
 * Implementations must build `modelInputs` ONLY from information available before kick-off.
 */
export interface SportsDataProvider {
  readonly id: string;
  readonly displayName: string;
  readonly isSimulated: boolean;

  listSports(): Promise<Sport[]>;
  listCompetitions(sportKey?: string): Promise<Competition[]>;
  listTeams(competitionKey?: string): Promise<Team[]>;
  listMatches(filter?: MatchFilter): Promise<Match[]>;
  getMatch(id: string): Promise<Match | null>;
  getStandings(competitionKey: string): Promise<StandingRow[]>;
}

export interface MatchFilter {
  competitionKey?: string;
  status?: MatchStatus[];
  teamKey?: string;
  /** ISO timestamp bounds on kick-off (inclusive). */
  from?: string;
  to?: string;
  limit?: number;
}
