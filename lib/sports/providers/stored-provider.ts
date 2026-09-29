import { DataUnavailableError } from "@/lib/api/errors";
import { getNow } from "@/lib/clock";
import type { MatchFilter, SportsDataProvider } from "@/lib/sports/providers/types";
import type { ResultInput } from "@/lib/sports/ratings";
import type { Competition, Match, MatchStatus, Sport, StandingRow, Team } from "@/lib/sports/types";
import {
  buildSeasonState,
  carryOverPriors,
  type Availability,
  type SeasonFixture,
  type SeasonState,
} from "@/lib/sports/walk-forward";

/**
 * Serves licensed football data that ingestion has written to PostgreSQL. Fixtures, results,
 * expected goals and availability come from the database; ratings, form, rest and table
 * positions are rebuilt walk-forward in memory (lib/sports/walk-forward.ts) and cached for
 * `ttlMs`, with concurrent requests sharing one in-flight rebuild.
 */

export interface StoredFootballRows {
  competitions: {
    id: string;
    key: string;
    name: string;
    region: string;
    season: string;
    baselineGoals: number;
    homeAdvantage: number;
  }[];
  teams: {
    key: string;
    name: string;
    shortName: string;
    code: string;
    city: string | null;
    venue: string | null;
  }[];
  matches: {
    externalRef: string;
    competitionId: string;
    homeTeamKey: string;
    awayTeamKey: string;
    kickoffAt: string;
    status: MatchStatus;
    matchday: number | null;
    venue: string | null;
    homeScore: number | null;
    awayScore: number | null;
    context: Record<string, unknown>;
    updatedAt: string;
  }[];
}

export interface StoredSportsDataProviderOptions {
  id: string;
  displayName: string;
  /** Competition keys to serve, in display order. */
  competitionKeys: readonly string[];
  load: () => Promise<StoredFootballRows>;
  /** Runs before every read, e.g. to opt the current page into request-time rendering. */
  beforeRead?: () => Promise<void>;
  clock?: () => Date;
  ttlMs?: number;
}

interface FootballState {
  seasons: SeasonState[];
  matchesById: Map<string, Match>;
  loadedAt: number;
}

const SPORT: Sport = { key: "football", name: "Football" };

/** "Premier League" → "PL", "Bundesliga" → "BUN", "Ligue 1" → "L1". */
export function competitionShortName(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return (words[0] ?? name).slice(0, 3).toUpperCase();
  return words
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 4);
}

function parseXg(value: unknown): { home: number; away: number } | null {
  if (!value || typeof value !== "object") return null;
  const { home, away } = value as { home?: unknown; away?: unknown };
  return typeof home === "number" && typeof away === "number" ? { home, away } : null;
}

function parseAvailability(value: unknown): Availability | null {
  if (!value || typeof value !== "object") return null;
  const side = (input: unknown) => {
    const record = (input ?? {}) as { out?: unknown; doubtful?: unknown };
    return {
      out: typeof record.out === "number" ? record.out : 0,
      doubtful: typeof record.doubtful === "number" ? record.doubtful : 0,
    };
  };
  const { home, away } = value as { home?: unknown; away?: unknown };
  return { home: side(home), away: side(away) };
}

export function buildFootballState(
  rows: StoredFootballRows,
  competitionKeys: readonly string[],
  now: Date,
): Omit<FootballState, "loadedAt"> {
  const teamRows = new Map(rows.teams.map((team) => [team.key, team]));
  const seasons: SeasonState[] = [];

  for (const key of competitionKeys) {
    const stored = rows.competitions
      .filter((competition) => competition.key === key)
      .sort((a, b) => b.season.localeCompare(a.season));
    const current = stored[0];
    if (!current) continue;
    const currentMatches = rows.matches.filter((match) => match.competitionId === current.id);
    if (currentMatches.length === 0) continue;

    const teamKeys = [
      ...new Set(currentMatches.flatMap((match) => [match.homeTeamKey, match.awayTeamKey])),
    ].filter((teamKey) => teamRows.has(teamKey));
    const teams: Team[] = teamKeys.map((teamKey) => {
      const row = teamRows.get(teamKey)!;
      return {
        key: row.key,
        name: row.name,
        shortName: row.shortName,
        code: row.code,
        city: row.city ?? "",
        venue: row.venue ?? "",
        competitionKey: key,
      };
    });

    const previous = stored[1];
    const previousMatches = previous
      ? rows.matches.filter((match) => match.competitionId === previous.id)
      : [];
    const previousResults: ResultInput[] = previousMatches
      .filter(
        (match) =>
          match.status === "finished" && match.homeScore !== null && match.awayScore !== null,
      )
      .map((match) => ({
        homeTeam: match.homeTeamKey,
        awayTeam: match.awayTeamKey,
        homeGoals: match.homeScore as number,
        awayGoals: match.awayScore as number,
      }));
    const { priors, league } = carryOverPriors(
      previous
        ? {
            teams: [...new Set(previousMatches.flatMap((m) => [m.homeTeamKey, m.awayTeamKey]))],
            results: previousResults,
          }
        : null,
      teamKeys,
      { baselineGoals: current.baselineGoals, homeAdvantage: current.homeAdvantage },
    );

    const fixtures: SeasonFixture[] = currentMatches.map((match) => ({
      id: match.externalRef,
      kickoffAt: match.kickoffAt,
      status: match.status,
      round: match.matchday ?? 0,
      venue: match.venue,
      homeKey: match.homeTeamKey,
      awayKey: match.awayTeamKey,
      score:
        match.status === "finished" && match.homeScore !== null && match.awayScore !== null
          ? { home: match.homeScore, away: match.awayScore }
          : null,
      xg: parseXg(match.context.xg),
      availability: parseAvailability(match.context.availability),
    }));

    seasons.push(
      buildSeasonState(
        {
          competition: {
            key,
            sportKey: SPORT.key,
            name: current.name,
            shortName: competitionShortName(current.name),
            region: current.region,
            season: current.season,
            baselineGoals: league.baselineGoals,
            homeAdvantage: league.homeAdvantage,
          },
          teams,
          fixtures,
          priors,
        },
        now,
      ),
    );
  }

  const matchesById = new Map<string, Match>();
  for (const season of seasons)
    for (const match of season.matches) matchesById.set(match.id, match);
  return { seasons, matchesById };
}

export class StoredSportsDataProvider implements SportsDataProvider {
  readonly isSimulated = false;
  private cached: FootballState | null = null;
  private inflight: Promise<FootballState> | null = null;

  constructor(private readonly options: StoredSportsDataProviderOptions) {}

  get id(): string {
    return this.options.id;
  }

  get displayName(): string {
    return this.options.displayName;
  }

  private async state(): Promise<FootballState> {
    await this.options.beforeRead?.();
    const ttl = this.options.ttlMs ?? 60_000;
    if (this.cached && Date.now() - this.cached.loadedAt < ttl) return this.cached;
    this.inflight ??= (async () => {
      const rows = await this.options.load();
      const now = (this.options.clock ?? getNow)();
      const state = {
        ...buildFootballState(rows, this.options.competitionKeys, now),
        loadedAt: Date.now(),
      };
      this.cached = state;
      return state;
    })().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Drop the cache (after an ingestion run in this process, and in tests). */
  invalidate(): void {
    this.cached = null;
  }

  private async seasons(): Promise<SeasonState[]> {
    const { seasons } = await this.state();
    if (seasons.length === 0) {
      throw new DataUnavailableError(
        `No ${this.displayName} football data has been ingested yet. Run \`pnpm ingest sports\` or wait for the scheduled ingestion job.`,
      );
    }
    return seasons;
  }

  async listSports(): Promise<Sport[]> {
    return [{ ...SPORT }];
  }

  async listCompetitions(sportKey?: string): Promise<Competition[]> {
    return (await this.seasons())
      .map((season) => season.competition)
      .filter((competition) => !sportKey || competition.sportKey === sportKey);
  }

  async listTeams(competitionKey?: string): Promise<Team[]> {
    return (await this.seasons())
      .filter((season) => !competitionKey || season.competition.key === competitionKey)
      .flatMap((season) => season.teams);
  }

  async listMatches(filter: MatchFilter = {}): Promise<Match[]> {
    let matches = (await this.seasons()).flatMap((season) => season.matches);
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
    return (await this.state()).matchesById.get(id.toLowerCase()) ?? null;
  }

  async getStandings(competitionKey: string): Promise<StandingRow[]> {
    return (
      (await this.seasons()).find((season) => season.competition.key === competitionKey)
        ?.standings ?? []
    );
  }
}
