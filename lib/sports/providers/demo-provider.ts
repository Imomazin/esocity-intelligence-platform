import { addDays, dayOfWeek, getNow, toIsoDate } from "@/lib/clock";
import { createRng } from "@/lib/quant/random";
import { mean, round } from "@/lib/quant/stats";
import {
  DEFAULT_MAX_GOALS,
  DEFAULT_RHO,
  INJURY_ATTACK_FACTOR,
  INJURY_DEFENCE_FACTOR,
  restModifier,
} from "@/lib/sports/football-model";
import {
  DEMO_COMPETITIONS,
  DEMO_SPORT,
  type DemoCompetitionDefinition,
} from "@/lib/sports/demo-universe";
import { buildScoreMatrix } from "@/lib/sports/poisson";
import type { MatchFilter, SportsDataProvider } from "@/lib/sports/providers/types";
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
  Sport,
  StandingRow,
  Team,
  TeamMatchContext,
} from "@/lib/sports/types";

/**
 * Deterministic demo season simulator.
 *
 * • Each competition plays a double round-robin, one round per week, rolling so that about nine
 *   rounds are always complete and the rest are upcoming relative to "now".
 * • Every club has a latent "true" attack/defence strength. Finished results are sampled from a
 *   Dixon–Coles Poisson process driven by those strengths, availability and fatigue.
 * • The model never sees the truth: before each round it re-estimates ratings from results of
 *   EARLIER rounds only (starting from imperfect pre-season priors), exactly as a live system
 *   would. That makes the prediction-performance metrics genuinely out-of-sample.
 */

const SEASON_LOOKBACK_DAYS = 63;
const MATCH_DURATION_MINUTES = 110;
const CACHE_BUCKET_MS = 5 * 60 * 1000;

interface Fixture {
  id: string;
  round: number;
  kickoffAt: Date;
  home: Team;
  away: Team;
}

interface SimulatedResult {
  homeGoals: number;
  awayGoals: number;
  xgHome: number;
  xgAway: number;
}

interface CompetitionState {
  competition: Competition;
  teams: Team[];
  fixtures: Fixture[];
  matches: Match[];
  standings: StandingRow[];
}

interface DemoSportsState {
  competitions: CompetitionState[];
  matchesById: Map<string, Match>;
}

function saturdayOnOrBefore(isoDate: string): string {
  let cursor = isoDate;
  while (dayOfWeek(cursor) !== 6) cursor = addDays(cursor, -1);
  return cursor;
}

function seasonLabel(seasonStart: string): string {
  const year = Number(seasonStart.slice(0, 4));
  const month = Number(seasonStart.slice(5, 7));
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * Circle-method double round-robin. Venues in the first half are assigned greedily so every
 * club alternates home/away as evenly as possible (the side with the lower home−away balance,
 * or who was away last, hosts). The second half mirrors the first with venues swapped, so each
 * club plays every opponent once at home and once away.
 */
function doubleRoundRobin<T extends { key: string }>(items: readonly T[]): [T, T][][] {
  const list = [...items];
  const n = list.length;
  const balance = new Map<string, number>();
  const lastWasHome = new Map<string, boolean>();
  const firstHalf: [T, T][][] = [];

  const hostScore = (team: T) => {
    const streakPenalty = lastWasHome.has(team.key) ? (lastWasHome.get(team.key) ? 0.5 : -0.5) : 0;
    return (balance.get(team.key) ?? 0) + streakPenalty;
  };

  for (let round = 0; round < n - 1; round++) {
    const pairs: [T, T][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i] as T;
      const b = list[n - 1 - i] as T;
      const scoreA = hostScore(a);
      const scoreB = hostScore(b);
      const aHosts = scoreA < scoreB || (scoreA === scoreB && (round + i) % 2 === 0);
      const [home, away] = aHosts ? [a, b] : [b, a];
      pairs.push([home, away]);
      balance.set(home.key, (balance.get(home.key) ?? 0) + 1);
      balance.set(away.key, (balance.get(away.key) ?? 0) - 1);
      lastWasHome.set(home.key, true);
      lastWasHome.set(away.key, false);
    }
    firstHalf.push(pairs);
    const last = list.pop() as T;
    list.splice(1, 0, last);
  }
  return [...firstHalf, ...firstHalf.map((pairs) => pairs.map(([h, a]) => [a, h] as [T, T]))];
}

function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rng = createRng(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

function normaliseRatings(ratings: Record<string, RatingPrior>): Record<string, RatingPrior> {
  const keys = Object.keys(ratings);
  const attackMean = mean(keys.map((key) => (ratings[key] as RatingPrior).attack));
  const defenceMean = mean(keys.map((key) => (ratings[key] as RatingPrior).defence));
  return Object.fromEntries(
    keys.map((key) => {
      const rating = ratings[key] as RatingPrior;
      return [key, { attack: rating.attack / attackMean, defence: rating.defence / defenceMean }];
    }),
  );
}

function trueStrengths(
  competitionKey: string,
  teams: readonly Team[],
): Record<string, RatingPrior> {
  const raw: Record<string, RatingPrior> = {};
  for (const team of teams) {
    const rng = createRng(`esocity:truth:${competitionKey}:${team.key}:v1`);
    const quality = rng.normal();
    raw[team.key] = {
      attack: Math.exp(0.24 * quality + 0.07 * rng.normal()),
      defence: Math.exp(-0.2 * quality + 0.07 * rng.normal()),
    };
  }
  return normaliseRatings(raw);
}

function preseasonPriors(
  competitionKey: string,
  truth: Record<string, RatingPrior>,
): Record<string, RatingPrior> {
  const noisy: Record<string, RatingPrior> = {};
  for (const [key, rating] of Object.entries(truth)) {
    const rng = createRng(`esocity:prior:${competitionKey}:${key}:v1`);
    noisy[key] = {
      attack: rating.attack * Math.exp(0.08 * rng.normal()),
      defence: rating.defence * Math.exp(0.08 * rng.normal()),
    };
  }
  return normaliseRatings(noisy);
}

function injuryLevel(competitionKey: string, teamKey: string, round: number): InjuryLevel {
  const u = createRng(`esocity:injury:${competitionKey}:${teamKey}:${round}`).next();
  if (u < 0.55) return "none";
  if (u < 0.8) return "minor";
  if (u < 0.94) return "moderate";
  return "major";
}

function playedMidweek(competitionKey: string, teamKey: string, round: number): boolean {
  return (
    round > 0 && createRng(`esocity:midweek:${competitionKey}:${teamKey}:${round}`).chance(0.2)
  );
}

function restDaysFor(
  competitionKey: string,
  team: Team,
  fixture: Fixture,
  previous: Fixture | undefined,
): number {
  if (playedMidweek(competitionKey, team.key, fixture.round)) return 3;
  if (!previous) return 14;
  return Math.max(
    2,
    Math.round((fixture.kickoffAt.getTime() - previous.kickoffAt.getTime()) / 86_400_000),
  );
}

function simulateResult(
  definition: DemoCompetitionDefinition,
  fixture: Fixture,
  truth: Record<string, RatingPrior>,
  restHome: number,
  restAway: number,
): SimulatedResult {
  const { competition } = definition;
  const rng = createRng(`esocity:result:${fixture.id}:v4`);
  const home = truth[fixture.home.key] as RatingPrior;
  const away = truth[fixture.away.key] as RatingPrior;
  const injuryHome = injuryLevel(competition.key, fixture.home.key, fixture.round);
  const injuryAway = injuryLevel(competition.key, fixture.away.key, fixture.round);
  const sqrtHa = Math.sqrt(competition.homeAdvantage);

  const lambdaHome =
    competition.baselineGoals *
    sqrtHa *
    home.attack *
    away.defence *
    INJURY_ATTACK_FACTOR[injuryHome] *
    INJURY_DEFENCE_FACTOR[injuryAway] *
    restModifier(restHome) *
    Math.exp(0.12 * rng.normal());
  const lambdaAway =
    (competition.baselineGoals / sqrtHa) *
    away.attack *
    home.defence *
    INJURY_ATTACK_FACTOR[injuryAway] *
    INJURY_DEFENCE_FACTOR[injuryHome] *
    restModifier(restAway) *
    Math.exp(0.12 * rng.normal());

  const matrix = buildScoreMatrix(lambdaHome, lambdaAway, { maxGoals: 10, rho: DEFAULT_RHO });
  let u = rng.next();
  let homeGoals = 0;
  let awayGoals = 0;
  outer: for (let h = 0; h <= matrix.maxGoals; h++) {
    for (let a = 0; a <= matrix.maxGoals; a++) {
      u -= (matrix.probabilities[h] as number[])[a] as number;
      if (u <= 0) {
        homeGoals = h;
        awayGoals = a;
        break outer;
      }
    }
  }

  return {
    homeGoals,
    awayGoals,
    xgHome: round(lambdaHome * Math.exp(0.2 * rng.normal()), 2),
    xgAway: round(lambdaAway * Math.exp(0.2 * rng.normal()), 2),
  };
}

function statusAt(kickoffAt: Date, now: Date): MatchStatus {
  const t = now.getTime();
  if (t >= kickoffAt.getTime() + MATCH_DURATION_MINUTES * 60_000) return "finished";
  if (t >= kickoffAt.getTime()) return "live";
  return "scheduled";
}

function outcomeFor(teamGoals: number, opponentGoals: number): FormResult {
  if (teamGoals > opponentGoals) return "W";
  if (teamGoals === opponentGoals) return "D";
  return "L";
}

interface TeamHistoryEntry {
  fixture: Fixture;
  result: SimulatedResult;
  isHome: boolean;
}

function buildStandings(
  teams: readonly Team[],
  history: Map<string, TeamHistoryEntry[]>,
): StandingRow[] {
  const rows = teams.map((team) => {
    const entries = history.get(team.key) ?? [];
    let won = 0;
    let drawn = 0;
    let lost = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;
    const form: FormResult[] = [];
    for (const entry of entries) {
      const scored = entry.isHome ? entry.result.homeGoals : entry.result.awayGoals;
      const conceded = entry.isHome ? entry.result.awayGoals : entry.result.homeGoals;
      goalsFor += scored;
      goalsAgainst += conceded;
      const outcome = outcomeFor(scored, conceded);
      form.push(outcome);
      if (outcome === "W") won += 1;
      else if (outcome === "D") drawn += 1;
      else lost += 1;
    }
    return {
      position: 0,
      team,
      played: entries.length,
      won,
      drawn,
      lost,
      goalsFor,
      goalsAgainst,
      goalDifference: goalsFor - goalsAgainst,
      points: won * 3 + drawn,
      form: form.slice(-5),
    };
  });
  rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      a.team.name.localeCompare(b.team.name),
  );
  return rows.map((row, i) => ({ ...row, position: i + 1 }));
}

function buildCompetitionState(definition: DemoCompetitionDefinition, now: Date): CompetitionState {
  const today = toIsoDate(now);
  const seasonStart = saturdayOnOrBefore(addDays(today, -SEASON_LOOKBACK_DAYS));
  const teams: Team[] = definition.teams.map((team) => ({
    ...team,
    competitionKey: definition.competition.key,
  }));
  const competition: Competition = {
    ...definition.competition,
    season: seasonLabel(seasonStart),
    teamCount: teams.length,
  };

  const ordered = seededShuffle(teams, `esocity:schedule:${competition.key}:v1`);
  const rounds = doubleRoundRobin(ordered);
  const fixtures: Fixture[] = [];
  rounds.forEach((pairs, roundIndex) => {
    const saturday = addDays(seasonStart, roundIndex * 7);
    pairs.forEach(([home, away], slotIndex) => {
      const [dayOffset, time] = definition.kickoffSlots[
        slotIndex % definition.kickoffSlots.length
      ] ?? [0, "15:00"];
      const kickoffAt = new Date(`${addDays(saturday, dayOffset)}T${time}:00Z`);
      fixtures.push({
        id: `${competition.shortName}-r${String(roundIndex + 1).padStart(2, "0")}-${home.code}-${away.code}`.toLowerCase(),
        round: roundIndex + 1,
        kickoffAt,
        home,
        away,
      });
    });
  });
  fixtures.sort(
    (a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime() || a.id.localeCompare(b.id),
  );

  const truth = trueStrengths(competition.key, teams);
  const priors = preseasonPriors(competition.key, truth);

  // Previous fixture per team (for rest days), independent of "now".
  const previousFixture = new Map<string, Fixture | undefined>();
  const lastSeen = new Map<string, Fixture>();
  for (const fixture of fixtures) {
    previousFixture.set(`${fixture.id}:${fixture.home.key}`, lastSeen.get(fixture.home.key));
    previousFixture.set(`${fixture.id}:${fixture.away.key}`, lastSeen.get(fixture.away.key));
    lastSeen.set(fixture.home.key, fixture);
    lastSeen.set(fixture.away.key, fixture);
  }

  const rest = (fixture: Fixture, team: Team) =>
    restDaysFor(competition.key, team, fixture, previousFixture.get(`${fixture.id}:${team.key}`));

  const results = new Map<string, SimulatedResult>();
  for (const fixture of fixtures) {
    results.set(
      fixture.id,
      simulateResult(
        definition,
        fixture,
        truth,
        rest(fixture, fixture.home),
        rest(fixture, fixture.away),
      ),
    );
  }

  const finished = fixtures.filter((fixture) => statusAt(fixture.kickoffAt, now) === "finished");
  const roundsCount = rounds.length;

  // Walk-forward pre-match state for each round: only results from earlier rounds.
  const roundState = new Map<
    number,
    {
      ratings: Record<string, { attack: number; defence: number }>;
      league: { baselineGoals: number; homeAdvantage: number };
      history: Map<string, TeamHistoryEntry[]>;
      standings: StandingRow[];
    }
  >();
  for (let roundNumber = 1; roundNumber <= roundsCount; roundNumber++) {
    const prior = finished.filter((fixture) => fixture.round < roundNumber);
    const resultInputs: ResultInput[] = prior.map((fixture) => {
      const result = results.get(fixture.id) as SimulatedResult;
      return {
        homeTeam: fixture.home.key,
        awayTeam: fixture.away.key,
        homeGoals: result.homeGoals,
        awayGoals: result.awayGoals,
      };
    });
    const league = estimateLeagueParameters(resultInputs, {
      baselineGoals: competition.baselineGoals,
      homeAdvantage: competition.homeAdvantage,
    });
    const ratings = estimateTeamRatings(
      teams.map((team) => team.key),
      resultInputs,
      league,
      priors,
    );
    const history = new Map<string, TeamHistoryEntry[]>();
    for (const fixture of prior) {
      const result = results.get(fixture.id) as SimulatedResult;
      for (const [team, isHome] of [
        [fixture.home, true],
        [fixture.away, false],
      ] as const) {
        const entries = history.get(team.key) ?? [];
        entries.push({ fixture, result, isHome });
        history.set(team.key, entries);
      }
    }
    roundState.set(roundNumber, {
      ratings,
      league: { baselineGoals: league.baselineGoals, homeAdvantage: league.homeAdvantage },
      history,
      standings: buildStandings(teams, history),
    });
  }

  const contextFor = (
    fixture: Fixture,
    team: Team,
    state: NonNullable<ReturnType<typeof roundState.get>>,
  ): TeamMatchContext => {
    const entries = (state.history.get(team.key) ?? []).slice(-5);
    const form = entries.map((entry) =>
      entry.isHome
        ? outcomeFor(entry.result.homeGoals, entry.result.awayGoals)
        : outcomeFor(entry.result.awayGoals, entry.result.homeGoals),
    );
    const rating = state.ratings[team.key] ?? { attack: 1, defence: 1 };
    const position = state.standings.find((row) => row.team.key === team.key)?.position ?? null;
    return {
      teamKey: team.key,
      form,
      xgFor: entries.length
        ? round(mean(entries.map((e) => (e.isHome ? e.result.xgHome : e.result.xgAway))), 2)
        : null,
      xgAgainst: entries.length
        ? round(mean(entries.map((e) => (e.isHome ? e.result.xgAway : e.result.xgHome))), 2)
        : null,
      injuries: injuryLevel(competition.key, team.key, fixture.round),
      restDays: rest(fixture, team),
      attackRating: round(rating.attack, 4),
      defenceRating: round(rating.defence, 4),
      leaguePosition: entries.length ? position : null,
    };
  };

  const matches: Match[] = fixtures.map((fixture) => {
    const state = roundState.get(fixture.round);
    if (!state) throw new Error(`Missing state for round ${fixture.round}`);
    const status = statusAt(fixture.kickoffAt, now);
    const result = results.get(fixture.id) as SimulatedResult;
    const home = contextFor(fixture, fixture.home, state);
    const away = contextFor(fixture, fixture.away, state);
    return {
      id: fixture.id,
      competitionKey: competition.key,
      round: fixture.round,
      kickoffAt: fixture.kickoffAt.toISOString(),
      status,
      venue: fixture.home.venue,
      homeTeam: fixture.home,
      awayTeam: fixture.away,
      score: status === "finished" ? { home: result.homeGoals, away: result.awayGoals } : null,
      xg: status === "finished" ? { home: result.xgHome, away: result.xgAway } : null,
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

  const currentHistory = new Map<string, TeamHistoryEntry[]>();
  for (const fixture of finished) {
    const result = results.get(fixture.id) as SimulatedResult;
    for (const [team, isHome] of [
      [fixture.home, true],
      [fixture.away, false],
    ] as const) {
      const entries = currentHistory.get(team.key) ?? [];
      entries.push({ fixture, result, isHome });
      currentHistory.set(team.key, entries);
    }
  }

  return {
    competition,
    teams,
    fixtures,
    matches,
    standings: buildStandings(teams, currentHistory),
  };
}

const stateCache = new Map<number, DemoSportsState>();

export function buildDemoSportsState(now: Date): DemoSportsState {
  const bucket = Math.floor(now.getTime() / CACHE_BUCKET_MS);
  const cached = stateCache.get(bucket);
  if (cached) return cached;
  const bucketNow = new Date(bucket * CACHE_BUCKET_MS);
  const competitions = DEMO_COMPETITIONS.map((definition) =>
    buildCompetitionState(definition, bucketNow),
  );
  const matchesById = new Map<string, Match>();
  for (const state of competitions) {
    for (const match of state.matches) matchesById.set(match.id, match);
  }
  const value: DemoSportsState = { competitions, matchesById };
  stateCache.clear();
  stateCache.set(bucket, value);
  return value;
}

export class DemoSportsDataProvider implements SportsDataProvider {
  readonly id = "demo";
  readonly displayName = "Esocity synthetic football (demo)";
  readonly isSimulated = true;

  constructor(private readonly clock: () => Date = getNow) {}

  private state(): DemoSportsState {
    return buildDemoSportsState(this.clock());
  }

  async listSports(): Promise<Sport[]> {
    return [{ ...DEMO_SPORT }];
  }

  async listCompetitions(sportKey?: string): Promise<Competition[]> {
    return this.state()
      .competitions.map((state) => state.competition)
      .filter((competition) => !sportKey || competition.sportKey === sportKey);
  }

  async listTeams(competitionKey?: string): Promise<Team[]> {
    return this.state()
      .competitions.filter((state) => !competitionKey || state.competition.key === competitionKey)
      .flatMap((state) => state.teams);
  }

  async listMatches(filter: MatchFilter = {}): Promise<Match[]> {
    let matches = this.state().competitions.flatMap((state) => state.matches);
    if (filter.competitionKey) {
      matches = matches.filter((match) => match.competitionKey === filter.competitionKey);
    }
    if (filter.status?.length) {
      const statuses = new Set(filter.status);
      matches = matches.filter((match) => statuses.has(match.status));
    }
    if (filter.teamKey) {
      matches = matches.filter(
        (match) => match.homeTeam.key === filter.teamKey || match.awayTeam.key === filter.teamKey,
      );
    }
    if (filter.from)
      matches = matches.filter((match) => match.kickoffAt >= (filter.from as string));
    if (filter.to) matches = matches.filter((match) => match.kickoffAt <= (filter.to as string));
    matches = [...matches].sort(
      (a, b) => a.kickoffAt.localeCompare(b.kickoffAt) || a.id.localeCompare(b.id),
    );
    return filter.limit ? matches.slice(0, filter.limit) : matches;
  }

  async getMatch(id: string): Promise<Match | null> {
    return this.state().matchesById.get(id.toLowerCase()) ?? null;
  }

  async getStandings(competitionKey: string): Promise<StandingRow[]> {
    return (
      this.state().competitions.find((state) => state.competition.key === competitionKey)
        ?.standings ?? []
    );
  }
}
