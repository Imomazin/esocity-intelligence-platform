import { z } from "zod";

import { ProviderError } from "@/lib/providers/errors";
import { ProviderHttpClient, type ProviderHttpClientOptions } from "@/lib/providers/http";
import type { MatchStatus } from "@/lib/sports/types";

/**
 * API-Football v3 (api-sports.io) adapter — used by ingestion only; pages read PostgreSQL.
 *
 *   Season + coverage  GET /leagues?id={league}&current=true   (or &season={year})
 *   Teams              GET /teams?league={league}&season={year}
 *   Fixtures/results   GET /fixtures?league={league}&season={year}
 *   Expected goals     GET /fixtures?ids={id-id-…}   (≤ 20 per call; includes statistics)
 *   Availability       GET /injuries?fixture={id}
 *
 * API-Football reports most failures with HTTP 200 and a non-empty `errors` object (invalid
 * key, daily quota, plan restrictions); those are mapped to typed ProviderErrors here. The key
 * travels in the `x-apisports-key` header only.
 */

export const API_FOOTBALL_DEFAULT_BASE_URL = "https://v3.football.api-sports.io";
export const MAX_IDS_PER_REQUEST = 20;

function envelope<T extends z.ZodType>(item: T) {
  return z.looseObject({
    errors: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
    results: z.number().optional(),
    paging: z.looseObject({ current: z.number(), total: z.number() }).optional(),
    response: z.array(item),
  });
}

const nullableNumber = z.number().nullable().optional();

const seasonSchema = z.looseObject({
  year: z.number().int(),
  start: z.string().optional(),
  end: z.string().optional(),
  current: z.boolean().optional(),
  coverage: z
    .looseObject({
      fixtures: z.looseObject({ statistics_fixtures: z.boolean().optional() }).optional(),
      injuries: z.boolean().optional(),
    })
    .optional(),
});

const leagueItemSchema = z.looseObject({
  league: z.looseObject({ id: z.number().int(), name: z.string(), type: z.string().optional() }),
  country: z.looseObject({ name: z.string().nullable().optional() }).optional(),
  seasons: z.array(seasonSchema),
});

const teamItemSchema = z.looseObject({
  team: z.looseObject({
    id: z.number().int(),
    name: z.string(),
    code: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
  }),
  venue: z
    .looseObject({ name: z.string().nullable().optional(), city: z.string().nullable().optional() })
    .nullable()
    .optional(),
});

const scorePairSchema = z
  .looseObject({ home: nullableNumber, away: nullableNumber })
  .nullable()
  .optional();

const statisticSchema = z.looseObject({
  type: z.string(),
  value: z.union([z.string(), z.number(), z.null()]).optional(),
});

const fixtureItemSchema = z.looseObject({
  fixture: z.looseObject({
    id: z.number().int(),
    date: z.string(),
    referee: z.string().nullable().optional(),
    venue: z
      .looseObject({
        name: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    status: z.looseObject({ short: z.string(), long: z.string().optional() }),
  }),
  league: z.looseObject({
    id: z.number().int(),
    season: z.number().int(),
    round: z.string().nullable().optional(),
  }),
  teams: z.looseObject({
    home: z.looseObject({ id: z.number().int(), name: z.string() }),
    away: z.looseObject({ id: z.number().int(), name: z.string() }),
  }),
  goals: scorePairSchema,
  score: z.looseObject({ fulltime: scorePairSchema }).nullable().optional(),
  statistics: z
    .array(
      z.looseObject({
        team: z.looseObject({ id: z.number().int() }),
        statistics: z.array(statisticSchema).nullable().optional(),
      }),
    )
    .optional(),
});

const injuryItemSchema = z.looseObject({
  player: z.looseObject({ type: z.string().nullable().optional() }),
  team: z.looseObject({ id: z.number().int() }),
  fixture: z.looseObject({ id: z.number().int() }).optional(),
});

export interface LeagueSeason {
  leagueId: number;
  name: string;
  country: string;
  season: number;
  /** "2025/26" for split-year seasons, "2026" for calendar-year leagues. */
  label: string;
  start: string | null;
  end: string | null;
  coverage: { injuries: boolean; statistics: boolean };
}

export interface UpstreamTeam {
  id: number;
  name: string;
  code: string | null;
  venue: string | null;
  city: string | null;
}

export interface UpstreamFixture {
  id: number;
  kickoffAt: string;
  status: MatchStatus;
  providerStatus: string;
  round: string | null;
  matchday: number | null;
  venue: string | null;
  referee: string | null;
  home: { id: number; name: string };
  away: { id: number; name: string };
  /** 90-minute score (finished matches only). */
  score: { home: number; away: number } | null;
}

export interface FixtureAvailability {
  home: { out: number; doubtful: number };
  away: { out: number; doubtful: number };
}

/** Short status codes → platform statuses. Awarded/walkover results were not played. */
const STATUS_MAP: Record<string, MatchStatus> = {
  TBD: "scheduled",
  NS: "scheduled",
  "1H": "live",
  HT: "live",
  "2H": "live",
  ET: "live",
  BT: "live",
  P: "live",
  LIVE: "live",
  SUSP: "live",
  INT: "live",
  FT: "finished",
  AET: "finished",
  PEN: "finished",
  PST: "postponed",
  CANC: "cancelled",
  ABD: "cancelled",
  AWD: "cancelled",
  WO: "cancelled",
};

export function mapFixtureStatus(short: string): MatchStatus | null {
  return STATUS_MAP[short.toUpperCase()] ?? null;
}

export function seasonLabel(season: number, start?: string | null, end?: string | null): string {
  const startYear = start ? Number(start.slice(0, 4)) : season;
  const endYear = end ? Number(end.slice(0, 4)) : season + 1;
  if (endYear === startYear) return String(startYear);
  return `${startYear}/${String(endYear % 100).padStart(2, "0")}`;
}

export function parseMatchday(round: string | null | undefined): number | null {
  const match = round ? /(\d+)\s*$/.exec(round) : null;
  return match ? Number(match[1]) : null;
}

/** Expected goals for both sides from a fixture's statistics block, when the league has them. */
export function extractExpectedGoals(
  item: z.output<typeof fixtureItemSchema>,
): { home: number; away: number } | null {
  const valueFor = (teamId: number) => {
    const block = item.statistics?.find((entry) => entry.team.id === teamId);
    const stat = block?.statistics?.find((entry) => entry.type.toLowerCase() === "expected_goals");
    const value = stat?.value === null || stat?.value === undefined ? NaN : Number(stat.value);
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
  };
  const home = valueFor(item.teams.home.id);
  const away = valueFor(item.teams.away.id);
  return home === null || away === null ? null : { home, away };
}

export function mapFixture(item: z.output<typeof fixtureItemSchema>): UpstreamFixture | null {
  const status = mapFixtureStatus(item.fixture.status.short);
  if (!status) return null;
  const fulltime = item.score?.fulltime;
  const home = fulltime?.home ?? item.goals?.home ?? null;
  const away = fulltime?.away ?? item.goals?.away ?? null;
  const score =
    status === "finished" &&
    home !== null &&
    home !== undefined &&
    away !== null &&
    away !== undefined
      ? { home, away }
      : null;
  // A result without a score cannot be used or stored as finished.
  if (status === "finished" && !score) return null;
  return {
    id: item.fixture.id,
    kickoffAt: new Date(item.fixture.date).toISOString(),
    status,
    providerStatus: item.fixture.status.short,
    round: item.league.round ?? null,
    matchday: parseMatchday(item.league.round),
    venue: item.fixture.venue?.name ?? null,
    referee: item.fixture.referee ?? null,
    home: { id: item.teams.home.id, name: item.teams.home.name },
    away: { id: item.teams.away.id, name: item.teams.away.name },
    score,
  };
}

export interface ApiFootballSourceOptions {
  apiKey: string;
  baseUrl?: string;
  /** Requests allowed in one ingestion run (the free plan allows 100 per day). */
  maxRequests?: number;
  /** Plan rate limit; the free plan allows ten requests per minute. */
  requestsPerMinute?: number;
  http?: Partial<ProviderHttpClientOptions>;
}

export class ApiFootballSource {
  readonly id = "api-football";
  readonly displayName = "API-Football";
  private readonly client: ProviderHttpClient;

  constructor(options: ApiFootballSourceOptions) {
    const perMinute = options.requestsPerMinute ?? 10;
    this.client = new ProviderHttpClient({
      providerId: this.id,
      baseUrl: options.baseUrl ?? API_FOOTBALL_DEFAULT_BASE_URL,
      headers: { "x-apisports-key": options.apiKey },
      // Spread requests evenly across the minute, with a little headroom.
      minIntervalMs: Math.ceil(60_000 / perMinute) + 250,
      maxRequests: options.maxRequests,
      maxBackoffMs: 65_000,
      ...options.http,
    });
  }

  get requestCount(): number {
    return this.client.requestCount;
  }

  get remainingRequests(): number {
    return this.client.remainingRequests;
  }

  private async get<T extends z.ZodType>(
    path: string,
    item: T,
    query: Record<string, string | number>,
  ): Promise<z.output<T>[]> {
    const body = await this.client.getJson(path, envelope(item), query);
    const errors = body.errors;
    const entries =
      errors && !Array.isArray(errors)
        ? Object.entries(errors as Record<string, unknown>)
        : (errors ?? []).map((value, index) => [String(index), value] as const);
    if (entries.length > 0) {
      const [key, value] = entries[0] as readonly [string, unknown];
      const text = String(value).slice(0, 200);
      const kind =
        key === "token" || key === "plan"
          ? "auth"
          : key === "requests"
            ? "budget_exhausted"
            : key === "rateLimit"
              ? "rate_limited"
              : "invalid_response";
      throw new ProviderError(this.id, `${path} rejected (${key}): ${text}`, { kind });
    }
    return body.response as z.output<T>[];
  }

  /** Current season (or a pinned one) with coverage flags. */
  async fetchLeagueSeason(leagueId: number, season?: number): Promise<LeagueSeason> {
    const response = await this.get(
      "/leagues",
      leagueItemSchema,
      season ? { id: leagueId, season } : { id: leagueId, current: "true" },
    );
    const entry = response[0];
    const chosen = entry?.seasons.find((item) => (season ? item.year === season : item.current));
    if (!entry || !chosen) {
      throw new ProviderError(
        this.id,
        `league ${leagueId} has no ${season ? `season ${season}` : "current season"}`,
        { kind: "not_found" },
      );
    }
    return {
      leagueId,
      name: entry.league.name,
      country: entry.country?.name ?? "International",
      season: chosen.year,
      label: seasonLabel(chosen.year, chosen.start, chosen.end),
      start: chosen.start ?? null,
      end: chosen.end ?? null,
      coverage: {
        injuries: chosen.coverage?.injuries ?? false,
        statistics: chosen.coverage?.fixtures?.statistics_fixtures ?? false,
      },
    };
  }

  async fetchTeams(leagueId: number, season: number): Promise<UpstreamTeam[]> {
    const response = await this.get("/teams", teamItemSchema, { league: leagueId, season });
    return response.map((item) => ({
      id: item.team.id,
      name: item.team.name,
      code: item.team.code ?? null,
      venue: item.venue?.name ?? null,
      city: item.venue?.city ?? null,
    }));
  }

  /** All fixtures of a league season; unknown statuses are reported, not guessed. */
  async fetchFixtures(
    leagueId: number,
    season: number,
  ): Promise<{ fixtures: UpstreamFixture[]; skipped: number }> {
    const response = await this.get("/fixtures", fixtureItemSchema, { league: leagueId, season });
    const fixtures: UpstreamFixture[] = [];
    let skipped = 0;
    for (const item of response) {
      const fixture = mapFixture(item);
      if (fixture) fixtures.push(fixture);
      else skipped += 1;
    }
    return { fixtures, skipped };
  }

  /** Expected goals for up to 20 fixtures; `null` when the provider has no xG for one. */
  async fetchExpectedGoals(
    fixtureIds: readonly number[],
  ): Promise<Map<number, { home: number; away: number } | null>> {
    if (fixtureIds.length === 0) return new Map();
    if (fixtureIds.length > MAX_IDS_PER_REQUEST) {
      throw new Error(`At most ${MAX_IDS_PER_REQUEST} fixtures per request`);
    }
    const response = await this.get("/fixtures", fixtureItemSchema, { ids: fixtureIds.join("-") });
    const result = new Map<number, { home: number; away: number } | null>(
      fixtureIds.map((id) => [id, null]),
    );
    for (const item of response) result.set(item.fixture.id, extractExpectedGoals(item));
    return result;
  }

  /** Players ruled out ("Missing Fixture") or doubtful ("Questionable") per side. */
  async fetchAvailability(
    fixture: Pick<UpstreamFixture, "id" | "home" | "away">,
  ): Promise<FixtureAvailability> {
    const response = await this.get("/injuries", injuryItemSchema, { fixture: fixture.id });
    const availability: FixtureAvailability = {
      home: { out: 0, doubtful: 0 },
      away: { out: 0, doubtful: 0 },
    };
    for (const item of response) {
      const side =
        item.team.id === fixture.home.id
          ? "home"
          : item.team.id === fixture.away.id
            ? "away"
            : null;
      if (!side) continue;
      if ((item.player.type ?? "").toLowerCase().startsWith("question")) {
        availability[side].doubtful += 1;
      } else {
        availability[side].out += 1;
      }
    }
    return availability;
  }
}
