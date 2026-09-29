import { ProviderError } from "@/lib/providers/errors";
import type {
  CompetitionUpsert,
  FixtureUpsert,
  FootballSource,
  SportsRepository,
  StoredFixtureState,
  TeamUpsert,
} from "@/lib/sports/ingestion";
import type {
  FixtureAvailability,
  LeagueSeason,
  UpstreamFixture,
  UpstreamTeam,
} from "@/lib/sports/providers/api-football";

export const FAKE_TEAMS: UpstreamTeam[] = [
  { id: 1, name: "Manchester United", code: "MUN", venue: "Old Trafford", city: "Manchester" },
  { id: 2, name: "Manchester City", code: "MCI", venue: "Etihad Stadium", city: "Manchester" },
  { id: 3, name: "Wolverhampton Wanderers", code: "WOL", venue: "Molineux", city: "Wolverhampton" },
  { id: 4, name: "AFC Bournemouth", code: null, venue: "Vitality Stadium", city: "Bournemouth" },
  { id: 5, name: "Brighton & Hove Albion", code: "BRI", venue: "Amex Stadium", city: "Brighton" },
  { id: 6, name: "Arsenal", code: "ARS", venue: "Emirates Stadium", city: "London" },
];

/** Double round-robin, one round a week from `start` (a Saturday), 15:00 UTC kick-offs. */
export function fakeSeason(
  teams: readonly UpstreamTeam[],
  start: string,
  now: Date,
  idOffset = 0,
): UpstreamFixture[] {
  const list = [...teams];
  const n = list.length;
  const rounds: [UpstreamTeam, UpstreamTeam][][] = [];
  for (let round = 0; round < n - 1; round++) {
    const pairs: [UpstreamTeam, UpstreamTeam][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i]!;
      const b = list[n - 1 - i]!;
      pairs.push(round % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()!);
  }
  const all = [
    ...rounds,
    ...rounds.map((pairs) => pairs.map(([h, a]) => [a, h] as [UpstreamTeam, UpstreamTeam])),
  ];
  const fixtures: UpstreamFixture[] = [];
  all.forEach((pairs, roundIndex) => {
    pairs.forEach(([home, away], slot) => {
      const kickoff = new Date(Date.parse(`${start}T15:00:00Z`) + roundIndex * 7 * 86_400_000);
      const id = idOffset + roundIndex * 10 + slot + 1;
      const finished = kickoff.getTime() + 2 * 3_600_000 <= now.getTime();
      fixtures.push({
        id,
        kickoffAt: kickoff.toISOString(),
        status: finished ? "finished" : "scheduled",
        providerStatus: finished ? "FT" : "NS",
        round: `Regular Season - ${roundIndex + 1}`,
        matchday: roundIndex + 1,
        venue: home.venue,
        referee: null,
        home: { id: home.id, name: home.name },
        away: { id: away.id, name: away.name },
        score: finished
          ? { home: (home.id + roundIndex) % 4, away: (away.id * 2 + roundIndex) % 3 }
          : null,
      });
    });
  });
  return fixtures;
}

export class FakeFootballSource implements FootballSource {
  readonly id = "api-football";
  readonly displayName = "API-Football";
  requestCount = 0;
  budget = 100;
  seasons = new Map<number, UpstreamFixture[]>();
  league: LeagueSeason = {
    leagueId: 39,
    name: "Premier League",
    country: "England",
    season: 2026,
    label: "2026/27",
    start: "2026-08-15",
    end: "2027-05-23",
    coverage: { injuries: true, statistics: true },
  };
  previousSeasonError: ProviderError | null = null;
  availabilityError: ProviderError | null = null;
  leagueError: ProviderError | null = null;
  calls: string[] = [];

  get remainingRequests(): number {
    return this.budget - this.requestCount;
  }

  private spend(call: string) {
    if (this.requestCount >= this.budget) {
      throw new ProviderError(this.id, "budget", { kind: "budget_exhausted" });
    }
    this.requestCount += 1;
    this.calls.push(call);
  }

  async fetchLeagueSeason(leagueId: number): Promise<LeagueSeason> {
    this.spend(`leagues:${leagueId}`);
    if (this.leagueError) throw this.leagueError;
    return { ...this.league, leagueId };
  }

  async fetchTeams(): Promise<UpstreamTeam[]> {
    this.spend("teams");
    return FAKE_TEAMS;
  }

  async fetchFixtures(_leagueId: number, season: number) {
    this.spend(`fixtures:${season}`);
    if (season !== this.league.season && this.previousSeasonError) throw this.previousSeasonError;
    return { fixtures: this.seasons.get(season) ?? [], skipped: 0 };
  }

  async fetchExpectedGoals(ids: readonly number[]) {
    this.spend(`xg:${ids.length}`);
    return new Map(ids.map((id) => [id, id % 10 === 2 ? null : { home: 1.2, away: 0.8 }] as const));
  }

  async fetchAvailability(fixture: Pick<UpstreamFixture, "id">): Promise<FixtureAvailability> {
    this.spend(`injuries:${fixture.id}`);
    if (this.availabilityError) throw this.availabilityError;
    return { home: { out: 2, doubtful: 1 }, away: { out: 0, doubtful: 0 } };
  }
}

interface MemoryFixture extends StoredFixtureState {
  competitionId: string;
  homeTeamKey: string;
  awayTeamKey: string;
  context: Record<string, unknown>;
}

export class MemorySportsRepository implements SportsRepository {
  competitions = new Map<string, CompetitionUpsert & { id: string }>();
  teams = new Map<string, TeamUpsert>();
  fixtures = new Map<string, MemoryFixture>();
  fixtureWrites = 0;

  async upsertCompetition(input: CompetitionUpsert): Promise<string> {
    const id = `${input.key}:${input.season}`;
    const existing = this.competitions.get(id);
    this.competitions.set(id, {
      ...input,
      ...(existing
        ? { baselineGoals: existing.baselineGoals, homeAdvantage: existing.homeAdvantage }
        : {}),
      id,
    });
    return id;
  }

  async findCompetition(key: string, season: string) {
    const id = `${key}:${season}`;
    if (!this.competitions.has(id)) return null;
    const rows = [...this.fixtures.values()].filter((fixture) => fixture.competitionId === id);
    return {
      id,
      fixtures: rows.length,
      finished: rows.filter((row) => row.status === "finished").length,
    };
  }

  async upsertTeams(rows: readonly TeamUpsert[], mode: "replace" | "insert-missing") {
    for (const row of rows) {
      if (mode === "insert-missing" && this.teams.has(row.key)) continue;
      this.teams.set(row.key, row);
    }
  }

  async readFixtureStates(competitionId: string) {
    return new Map(
      [...this.fixtures.values()]
        .filter((fixture) => fixture.competitionId === competitionId)
        .map((fixture) => [
          fixture.externalRef,
          { ...fixture, xgChecked: fixture.context.xgChecked === true },
        ]),
    );
  }

  async upsertFixtures(competitionId: string, rows: readonly FixtureUpsert[]) {
    for (const row of rows) {
      if (!this.teams.has(row.homeTeamKey) || !this.teams.has(row.awayTeamKey)) {
        throw new Error(`Unknown team for fixture ${row.externalRef}`);
      }
      const existing = this.fixtures.get(row.externalRef);
      this.fixtures.set(row.externalRef, {
        competitionId,
        externalRef: row.externalRef,
        homeTeamKey: row.homeTeamKey,
        awayTeamKey: row.awayTeamKey,
        status: row.status,
        kickoffAt: row.kickoffAt,
        matchday: row.matchday,
        venue: row.venue,
        homeScore: row.homeScore,
        awayScore: row.awayScore,
        xgChecked: false,
        context: { ...(existing?.context ?? {}), ...row.context },
      });
    }
    this.fixtureWrites += rows.length;
    return rows.length;
  }

  async mergeFixtureContext(externalRef: string, patch: Record<string, unknown>) {
    const fixture = this.fixtures.get(externalRef);
    if (fixture) fixture.context = { ...fixture.context, ...patch };
  }
}
