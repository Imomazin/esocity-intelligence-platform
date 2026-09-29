import { mean, round } from "@/lib/quant/stats";
import { DEFAULT_MAX_GOALS, DEFAULT_RHO } from "@/lib/sports/football-model";
import {
  estimateLeagueParameters,
  estimateTeamRatings,
  type RatingPrior,
  type ResultInput,
} from "@/lib/sports/ratings";
import type {
  Competition,
  FormResult,
  InjuryLevel,
  Match,
  MatchStatus,
  StandingRow,
  Team,
  TeamMatchContext,
} from "@/lib/sports/types";

/**
 * Walk-forward pre-match state for a real (ingested) league season.
 *
 * For every fixture, ratings, league parameters, form, expected goals, rest and table position
 * are rebuilt from results that were FINAL before its kick-off (kick-off + 110 minutes ≤ this
 * kick-off), so predictions for finished matches are genuinely out-of-sample — the same
 * discipline the demo season follows, applied to real fixture times instead of rounds.
 *
 * Priors: clubs start from last season's ratings regressed toward average (between-season
 * regression), promoted clubs from the average of the clubs they replaced, and the league
 * scoring rate / home advantage from last season's estimates.
 */

export const MATCH_DURATION_MS = 110 * 60_000;
/** Share of last season's (log) rating carried into the new season. */
export const SEASON_CARRY_OVER = 0.7;
const MIN_PRIOR_MATCHES = 10;

export interface Availability {
  home: { out: number; doubtful: number };
  away: { out: number; doubtful: number };
}

export interface SeasonFixture {
  id: string;
  kickoffAt: string;
  status: MatchStatus;
  round: number;
  venue: string | null;
  homeKey: string;
  awayKey: string;
  score: { home: number; away: number } | null;
  xg: { home: number; away: number } | null;
  availability: Availability | null;
}

export interface SeasonInput {
  competition: Omit<Competition, "teamCount">;
  teams: readonly Team[];
  fixtures: readonly SeasonFixture[];
  priors?: Readonly<Record<string, RatingPrior>>;
}

export interface SeasonState {
  competition: Competition;
  teams: Team[];
  matches: Match[];
  standings: StandingRow[];
}

interface PlayedResult {
  fixture: SeasonFixture;
  score: { home: number; away: number };
  finalAt: number;
}

/** Availability → the model's four-level scale (doubtful players count half). */
export function availabilityLevel(
  side: { out: number; doubtful: number } | undefined,
): InjuryLevel {
  if (!side) return "none";
  const weighted = side.out + 0.5 * side.doubtful;
  if (weighted < 1) return "none";
  if (weighted < 3) return "minor";
  if (weighted < 6) return "moderate";
  return "major";
}

function outcomeFor(scored: number, conceded: number): FormResult {
  if (scored > conceded) return "W";
  if (scored === conceded) return "D";
  return "L";
}

export function buildStandings(
  teams: readonly Team[],
  results: readonly { homeKey: string; awayKey: string; home: number; away: number }[],
): StandingRow[] {
  const rows = new Map(
    teams.map((team) => [
      team.key,
      {
        position: 0,
        team,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
        form: [] as FormResult[],
      },
    ]),
  );
  for (const result of results) {
    for (const [key, scored, conceded] of [
      [result.homeKey, result.home, result.away],
      [result.awayKey, result.away, result.home],
    ] as const) {
      const row = rows.get(key);
      if (!row) continue;
      const outcome = outcomeFor(scored, conceded);
      row.played += 1;
      row.goalsFor += scored;
      row.goalsAgainst += conceded;
      row.goalDifference = row.goalsFor - row.goalsAgainst;
      if (outcome === "W") row.won += 1;
      else if (outcome === "D") row.drawn += 1;
      else row.lost += 1;
      row.points = row.won * 3 + row.drawn;
      row.form = [...row.form, outcome].slice(-5);
    }
  }
  return [...rows.values()]
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDifference - a.goalDifference ||
        b.goalsFor - a.goalsFor ||
        a.team.name.localeCompare(b.team.name),
    )
    .map((row, index) => ({ ...row, position: index + 1 }));
}

/**
 * Ratings priors for a new season from the previous one. Returns neutral priors when there is no
 * usable history.
 */
export function carryOverPriors(
  previous: { teams: readonly string[]; results: readonly ResultInput[] } | null,
  currentTeams: readonly string[],
  fallback: { baselineGoals: number; homeAdvantage: number },
): {
  priors: Record<string, RatingPrior>;
  league: { baselineGoals: number; homeAdvantage: number };
} {
  if (!previous || previous.results.length < 20) return { priors: {}, league: fallback };
  const league = estimateLeagueParameters(previous.results, fallback);
  const ratings = estimateTeamRatings(previous.teams, previous.results, league, {});
  const regress = (value: number) => Math.exp(SEASON_CARRY_OVER * Math.log(value));

  // Clubs that left the league are the best available proxy for the clubs that replaced them.
  const departed = previous.teams.filter((team) => !currentTeams.includes(team));
  const proxy =
    departed.length > 0
      ? {
          attack: Math.exp(mean(departed.map((team) => Math.log(ratings[team]?.attack ?? 1)))),
          defence: Math.exp(mean(departed.map((team) => Math.log(ratings[team]?.defence ?? 1)))),
        }
      : { attack: 1, defence: 1 };

  const priors: Record<string, RatingPrior> = {};
  for (const team of currentTeams) {
    const rating = ratings[team];
    const source =
      rating && rating.matches >= MIN_PRIOR_MATCHES
        ? { attack: rating.attack, defence: rating.defence }
        : proxy;
    priors[team] = { attack: regress(source.attack), defence: regress(source.defence) };
  }
  return {
    priors,
    league: { baselineGoals: league.baselineGoals, homeAdvantage: league.homeAdvantage },
  };
}

export function buildSeasonState(input: SeasonInput, now: Date): SeasonState {
  const teamsByKey = new Map(input.teams.map((team) => [team.key, team]));
  const teamKeys = [...teamsByKey.keys()];
  const fixtures = [...input.fixtures]
    .filter((fixture) => teamsByKey.has(fixture.homeKey) && teamsByKey.has(fixture.awayKey))
    .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt) || a.id.localeCompare(b.id));

  const played: PlayedResult[] = fixtures
    .filter((fixture) => fixture.status === "finished" && fixture.score)
    .map((fixture) => ({
      fixture,
      score: fixture.score as { home: number; away: number },
      finalAt: Date.parse(fixture.kickoffAt) + MATCH_DURATION_MS,
    }))
    .sort((a, b) => a.finalAt - b.finalAt);

  const priors = input.priors ?? {};
  const leaguePrior = {
    baselineGoals: input.competition.baselineGoals,
    homeAdvantage: input.competition.homeAdvantage,
  };

  // State after the first k results, computed once per distinct k.
  const states = new Map<
    number,
    {
      league: { baselineGoals: number; homeAdvantage: number };
      ratings: Record<string, { attack: number; defence: number }>;
      standings: StandingRow[];
    }
  >();
  const stateAt = (k: number) => {
    let state = states.get(k);
    if (!state) {
      const results: ResultInput[] = played.slice(0, k).map((entry) => ({
        homeTeam: entry.fixture.homeKey,
        awayTeam: entry.fixture.awayKey,
        homeGoals: entry.score.home,
        awayGoals: entry.score.away,
      }));
      const league = estimateLeagueParameters(results, leaguePrior);
      state = {
        league: { baselineGoals: league.baselineGoals, homeAdvantage: league.homeAdvantage },
        ratings: estimateTeamRatings(teamKeys, results, league, priors),
        standings: buildStandings(
          input.teams,
          played.slice(0, k).map((entry) => ({
            homeKey: entry.fixture.homeKey,
            awayKey: entry.fixture.awayKey,
            home: entry.score.home,
            away: entry.score.away,
          })),
        ),
      };
      states.set(k, state);
    }
    return state;
  };

  /** Number of results final strictly before `instant` (binary search on finalAt). */
  const resultsBefore = (instant: number) => {
    let low = 0;
    let high = played.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((played[mid] as PlayedResult).finalAt <= instant) low = mid + 1;
      else high = mid;
    }
    return low;
  };

  const contextFor = (
    fixture: SeasonFixture,
    teamKey: string,
    k: number,
    side: "home" | "away",
  ): TeamMatchContext => {
    const state = stateAt(k);
    const history = played
      .slice(0, k)
      .filter((entry) => entry.fixture.homeKey === teamKey || entry.fixture.awayKey === teamKey);
    const recent = history.slice(-5);
    const perspective = recent.map((entry) => {
      const isHome = entry.fixture.homeKey === teamKey;
      return {
        scored: isHome ? entry.score.home : entry.score.away,
        conceded: isHome ? entry.score.away : entry.score.home,
        xgFor: entry.fixture.xg ? (isHome ? entry.fixture.xg.home : entry.fixture.xg.away) : null,
        xgAgainst: entry.fixture.xg
          ? isHome
            ? entry.fixture.xg.away
            : entry.fixture.xg.home
          : null,
      };
    });
    const xgFor = perspective.flatMap((entry) => (entry.xgFor === null ? [] : [entry.xgFor]));
    const xgAgainst = perspective.flatMap((entry) =>
      entry.xgAgainst === null ? [] : [entry.xgAgainst],
    );
    // Rest: the club's previous league fixture that actually took place before this kick-off.
    const kickoff = Date.parse(fixture.kickoffAt);
    const previous = fixtures
      .filter(
        (candidate) =>
          candidate.id !== fixture.id &&
          (candidate.homeKey === teamKey || candidate.awayKey === teamKey) &&
          (candidate.status === "finished" || candidate.status === "live") &&
          Date.parse(candidate.kickoffAt) < kickoff,
      )
      .at(-1);
    const rating = state.ratings[teamKey] ?? { attack: 1, defence: 1 };
    const position = state.standings.find((row) => row.team.key === teamKey);
    return {
      teamKey,
      form: perspective.map((entry) => outcomeFor(entry.scored, entry.conceded)),
      xgFor: xgFor.length ? round(mean(xgFor), 2) : null,
      xgAgainst: xgAgainst.length ? round(mean(xgAgainst), 2) : null,
      injuries: availabilityLevel(fixture.availability?.[side]),
      restDays: previous
        ? Math.max(1, Math.round((kickoff - Date.parse(previous.kickoffAt)) / 86_400_000))
        : null,
      attackRating: round(rating.attack, 4),
      defenceRating: round(rating.defence, 4),
      leaguePosition: position && position.played > 0 ? position.position : null,
    };
  };

  const matches: Match[] = fixtures.map((fixture) => {
    const k = resultsBefore(Date.parse(fixture.kickoffAt));
    const state = stateAt(k);
    const home = contextFor(fixture, fixture.homeKey, k, "home");
    const away = contextFor(fixture, fixture.awayKey, k, "away");
    const homeTeam = teamsByKey.get(fixture.homeKey) as Team;
    const awayTeam = teamsByKey.get(fixture.awayKey) as Team;
    const finished = fixture.status === "finished" && fixture.score !== null;
    return {
      id: fixture.id,
      competitionKey: input.competition.key,
      round: fixture.round,
      kickoffAt: fixture.kickoffAt,
      status: fixture.status,
      venue: fixture.venue ?? homeTeam.venue,
      homeTeam,
      awayTeam,
      score: finished ? fixture.score : null,
      xg: finished ? fixture.xg : null,
      context: { home, away },
      modelInputs: {
        home: {
          attack: home.attackRating,
          defence: home.defenceRating,
          form: home.form,
          xgFor: home.xgFor ?? undefined,
          xgAgainst: home.xgAgainst ?? undefined,
          injuries: home.injuries,
          restDays: home.restDays ?? undefined,
        },
        away: {
          attack: away.attackRating,
          defence: away.defenceRating,
          form: away.form,
          xgFor: away.xgFor ?? undefined,
          xgAgainst: away.xgAgainst ?? undefined,
          injuries: away.injuries,
          restDays: away.restDays ?? undefined,
        },
        leagueBaselineGoals: round(state.league.baselineGoals, 4),
        homeAdvantage: round(state.league.homeAdvantage, 4),
        rho: DEFAULT_RHO,
        maxGoals: DEFAULT_MAX_GOALS,
      },
    };
  });

  const current = stateAt(resultsBefore(now.getTime()));
  return {
    competition: {
      ...input.competition,
      baselineGoals: round(current.league.baselineGoals, 4),
      homeAdvantage: round(current.league.homeAdvantage, 4),
      teamCount: input.teams.length,
    },
    teams: [...input.teams],
    matches,
    standings: buildStandings(
      input.teams,
      played.map((entry) => ({
        homeKey: entry.fixture.homeKey,
        awayKey: entry.fixture.awayKey,
        home: entry.score.home,
        away: entry.score.away,
      })),
    ),
  };
}
