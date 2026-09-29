import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { competitions, matches, sports, teams } from "@/db/schema";
import type {
  CompetitionUpsert,
  FixtureUpsert,
  SportsRepository,
  StoredFixtureState,
  TeamUpsert,
} from "@/lib/sports/ingestion";
import type { MatchStatus } from "@/lib/sports/types";

/**
 * PostgreSQL access for ingested football data. Match `context` is a JSON document built by
 * several writers (fixture sync, expected goals, availability), so writes MERGE into it
 * (`context || patch`) instead of replacing it.
 */

const BATCH_SIZE = 200;
const FOOTBALL = { key: "football", name: "Football" } as const;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

export class PostgresSportsRepository implements SportsRepository {
  private sportIdPromise: Promise<string> | null = null;

  constructor(private readonly db: Database) {}

  private sportId(): Promise<string> {
    this.sportIdPromise ??= (async () => {
      const [row] = await this.db
        .insert(sports)
        .values({ key: FOOTBALL.key, name: FOOTBALL.name })
        .onConflictDoUpdate({ target: sports.key, set: { updatedAt: new Date() } })
        .returning({ id: sports.id });
      if (!row) throw new Error("Failed to upsert the football sport row");
      return row.id;
    })();
    return this.sportIdPromise;
  }

  async upsertCompetition(input: CompetitionUpsert): Promise<string> {
    const [row] = await this.db
      .insert(competitions)
      .values({
        sportId: await this.sportId(),
        key: input.key,
        name: input.name.slice(0, 120),
        region: input.region.slice(0, 80),
        season: input.season,
        baselineGoals: input.baselineGoals,
        homeAdvantage: input.homeAdvantage,
        externalRef: input.externalRef,
      })
      // Model priors are set on insert only; the name and region follow the provider.
      .onConflictDoUpdate({
        target: [competitions.key, competitions.season],
        set: {
          name: sql`excluded.name`,
          region: sql`excluded.region`,
          externalRef: sql`excluded.external_ref`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: competitions.id });
    if (!row) throw new Error(`Failed to upsert competition ${input.key} ${input.season}`);
    return row.id;
  }

  async findCompetition(
    key: string,
    season: string,
  ): Promise<{ id: string; fixtures: number; finished: number } | null> {
    const [row] = await this.db
      .select({
        id: competitions.id,
        fixtures: sql<number>`count(${matches.id})::int`,
        finished: sql<number>`(count(${matches.id}) filter (where ${matches.status} = 'finished'))::int`,
      })
      .from(competitions)
      .leftJoin(matches, eq(matches.competitionId, competitions.id))
      .where(and(eq(competitions.key, key), eq(competitions.season, season)))
      .groupBy(competitions.id);
    return row ?? null;
  }

  async upsertTeams(
    rows: readonly TeamUpsert[],
    mode: "replace" | "insert-missing",
  ): Promise<void> {
    if (rows.length === 0) return;
    const sportId = await this.sportId();
    const values = rows.map((team) => ({
      sportId,
      competitionId: team.competitionId,
      key: team.key,
      name: team.name,
      shortName: team.shortName,
      code: team.code,
      city: team.city?.slice(0, 80) ?? null,
      externalRef: team.externalRef,
      metadata: team.metadata,
    }));
    for (const batch of chunk(values, BATCH_SIZE)) {
      const insert = this.db.insert(teams).values(batch);
      if (mode === "replace") {
        await insert.onConflictDoUpdate({
          target: teams.key,
          set: {
            competitionId: sql`excluded.competition_id`,
            name: sql`excluded.name`,
            shortName: sql`excluded.short_name`,
            code: sql`excluded.code`,
            city: sql`excluded.city`,
            externalRef: sql`excluded.external_ref`,
            metadata: sql`excluded.metadata`,
            updatedAt: new Date(),
          },
        });
      } else {
        await insert.onConflictDoNothing({ target: teams.key });
      }
    }
  }

  async readFixtureStates(competitionId: string): Promise<Map<string, StoredFixtureState>> {
    const rows = await this.db
      .select({
        externalRef: matches.externalRef,
        status: matches.status,
        kickoffAt: matches.kickoffAt,
        matchday: matches.matchday,
        venue: matches.venue,
        homeScore: matches.homeScore,
        awayScore: matches.awayScore,
        xgChecked: sql<boolean>`coalesce((${matches.context} ->> 'xgChecked')::boolean, false)`,
      })
      .from(matches)
      .where(eq(matches.competitionId, competitionId));
    return new Map(
      rows.map((row) => [
        row.externalRef,
        { ...row, kickoffAt: row.kickoffAt.toISOString(), status: row.status as MatchStatus },
      ]),
    );
  }

  async upsertFixtures(competitionId: string, fixtures: readonly FixtureUpsert[]): Promise<number> {
    if (fixtures.length === 0) return 0;
    const keys = [...new Set(fixtures.flatMap((f) => [f.homeTeamKey, f.awayTeamKey]))];
    const teamRows = await this.db
      .select({ id: teams.id, key: teams.key })
      .from(teams)
      .where(inArray(teams.key, keys));
    const teamId = new Map(teamRows.map((row) => [row.key, row.id]));

    let written = 0;
    for (const batch of chunk(fixtures, BATCH_SIZE)) {
      const rows = await this.db
        .insert(matches)
        .values(
          batch.map((fixture) => {
            const home = teamId.get(fixture.homeTeamKey);
            const away = teamId.get(fixture.awayTeamKey);
            if (!home || !away) throw new Error(`Unknown team for fixture ${fixture.externalRef}`);
            return {
              competitionId,
              homeTeamId: home,
              awayTeamId: away,
              kickoffAt: new Date(fixture.kickoffAt),
              status: fixture.status,
              matchday: fixture.matchday,
              venue: fixture.venue?.slice(0, 160) ?? null,
              homeScore: fixture.homeScore,
              awayScore: fixture.awayScore,
              externalRef: fixture.externalRef,
              context: fixture.context,
            };
          }),
        )
        .onConflictDoUpdate({
          target: matches.externalRef,
          set: {
            competitionId: sql`excluded.competition_id`,
            homeTeamId: sql`excluded.home_team_id`,
            awayTeamId: sql`excluded.away_team_id`,
            kickoffAt: sql`excluded.kickoff_at`,
            status: sql`excluded.status`,
            matchday: sql`excluded.matchday`,
            venue: sql`excluded.venue`,
            homeScore: sql`excluded.home_score`,
            awayScore: sql`excluded.away_score`,
            context: sql`${matches.context} || excluded.context`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: matches.id });
      written += rows.length;
    }
    return written;
  }

  async mergeFixtureContext(externalRef: string, patch: Record<string, unknown>): Promise<void> {
    await this.db
      .update(matches)
      .set({
        context: sql`${matches.context} || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(matches.externalRef, externalRef));
  }
}

export interface CompetitionCoverage {
  key: string;
  name: string;
  season: string;
  fixtures: number;
  finished: number;
  upcoming: number;
  overdue: number;
  withXg: number;
  lastResult: string | null;
  lastUpdated: string | null;
}

/** Freshness counters for the latest stored season of each competition. */
export async function readFootballCoverage(
  db: Database,
  competitionKeys: readonly string[],
  now: Date,
): Promise<CompetitionCoverage[]> {
  if (competitionKeys.length === 0) return [];
  // Raw SQL parameters get no column mapping: pass timestamps as ISO text, cast in SQL.
  const nowParam = now.toISOString();
  const overdueBefore = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const rows = await db
    .select({
      key: competitions.key,
      name: competitions.name,
      season: competitions.season,
      fixtures: sql<number>`count(${matches.id})::int`,
      finished: sql<number>`(count(${matches.id}) filter (where ${matches.status} = 'finished'))::int`,
      upcoming: sql<number>`(count(${matches.id}) filter (where ${matches.status} = 'scheduled' and ${matches.kickoffAt} >= ${nowParam}::timestamptz))::int`,
      overdue: sql<number>`(count(${matches.id}) filter (where ${matches.status} in ('scheduled', 'live') and ${matches.kickoffAt} < ${overdueBefore}::timestamptz))::int`,
      withXg: sql<number>`(count(${matches.id}) filter (where ${matches.status} = 'finished' and jsonb_typeof(${matches.context} -> 'xg') = 'object'))::int`,
      lastResult: sql<
        string | null
      >`to_char(max(${matches.kickoffAt}) filter (where ${matches.status} = 'finished') at time zone 'UTC', 'YYYY-MM-DD')`,
      lastUpdated: sql<
        string | null
      >`to_char(max(${matches.updatedAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
    })
    .from(competitions)
    .leftJoin(matches, eq(matches.competitionId, competitions.id))
    .where(inArray(competitions.key, [...competitionKeys]))
    .groupBy(competitions.id);

  // Latest season per competition, in configured order.
  return competitionKeys.flatMap((key) => {
    const latest = rows
      .filter((row) => row.key === key)
      .sort((a, b) => b.season.localeCompare(a.season))[0];
    return latest
      ? [latest]
      : [
          {
            key,
            name: key,
            season: "—",
            fixtures: 0,
            finished: 0,
            upcoming: 0,
            overdue: 0,
            withXg: 0,
            lastResult: null,
            lastUpdated: null,
          },
        ];
  });
}

export interface StoredCompetitionSeason {
  id: string;
  key: string;
  name: string;
  region: string;
  season: string;
  baselineGoals: number;
  homeAdvantage: number;
}

export interface StoredTeamRow {
  key: string;
  name: string;
  shortName: string;
  code: string;
  city: string | null;
  venue: string | null;
}

export interface StoredMatchRow {
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
}

export interface FootballSnapshotRows {
  competitions: StoredCompetitionSeason[];
  teams: StoredTeamRow[];
  matches: StoredMatchRow[];
}

/** Every stored season of the given competitions with their clubs and fixtures. */
export async function readFootballSnapshot(
  db: Database,
  competitionKeys: readonly string[],
): Promise<FootballSnapshotRows> {
  if (competitionKeys.length === 0) return { competitions: [], teams: [], matches: [] };
  const competitionRows = await db
    .select({
      id: competitions.id,
      key: competitions.key,
      name: competitions.name,
      region: competitions.region,
      season: competitions.season,
      baselineGoals: competitions.baselineGoals,
      homeAdvantage: competitions.homeAdvantage,
    })
    .from(competitions)
    .where(inArray(competitions.key, [...competitionKeys]));
  if (competitionRows.length === 0) return { competitions: [], teams: [], matches: [] };

  const matchRows = await db
    .select({
      externalRef: matches.externalRef,
      competitionId: matches.competitionId,
      homeTeamId: matches.homeTeamId,
      awayTeamId: matches.awayTeamId,
      kickoffAt: matches.kickoffAt,
      status: matches.status,
      matchday: matches.matchday,
      venue: matches.venue,
      homeScore: matches.homeScore,
      awayScore: matches.awayScore,
      context: matches.context,
      updatedAt: matches.updatedAt,
    })
    .from(matches)
    .where(
      inArray(
        matches.competitionId,
        competitionRows.map((row) => row.id),
      ),
    )
    .orderBy(asc(matches.kickoffAt), asc(matches.externalRef));

  const teamIds = [...new Set(matchRows.flatMap((row) => [row.homeTeamId, row.awayTeamId]))];
  const teamRows =
    teamIds.length === 0
      ? []
      : await db
          .select({
            id: teams.id,
            key: teams.key,
            name: teams.name,
            shortName: teams.shortName,
            code: teams.code,
            city: teams.city,
            metadata: teams.metadata,
          })
          .from(teams)
          .where(inArray(teams.id, teamIds));
  const teamKeyById = new Map(teamRows.map((row) => [row.id, row.key]));

  return {
    competitions: competitionRows.map((row) => ({ ...row, region: row.region ?? "" })),
    teams: teamRows.map((row) => ({
      key: row.key,
      name: row.name,
      shortName: row.shortName,
      code: row.code,
      city: row.city,
      venue: typeof row.metadata.venue === "string" ? row.metadata.venue : null,
    })),
    matches: matchRows.map((row) => ({
      externalRef: row.externalRef,
      competitionId: row.competitionId,
      homeTeamKey: teamKeyById.get(row.homeTeamId) ?? "",
      awayTeamKey: teamKeyById.get(row.awayTeamId) ?? "",
      kickoffAt: row.kickoffAt.toISOString(),
      status: row.status as MatchStatus,
      matchday: row.matchday,
      venue: row.venue,
      homeScore: row.homeScore,
      awayScore: row.awayScore,
      context: row.context,
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}
