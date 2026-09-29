import { describe, expect, it, vi } from "vitest";

import type { IngestionContext } from "@/lib/ingestion/runner";
import { ProviderError } from "@/lib/providers/errors";
import {
  competitionKey,
  deriveCode,
  deriveShortNames,
  ingestFootball,
  matchRef,
  previousSeasonLabel,
  teamKey,
} from "@/lib/sports/ingestion";
import {
  ApiFootballSource,
  mapFixtureStatus,
  parseMatchday,
  seasonLabel,
} from "@/lib/sports/providers/api-football";
import {
  FAKE_TEAMS,
  FakeFootballSource,
  fakeSeason,
  MemorySportsRepository,
} from "@/tests/helpers/sports-fakes";

const KEY = "af_test_0123456789abcdef";

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function apiFootball(responses: Response[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return next;
  });
  const source = new ApiFootballSource({
    apiKey: KEY,
    http: { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => undefined },
  });
  return { source, calls };
}

const fixtureItem = (overrides: Record<string, unknown> = {}) => ({
  fixture: {
    id: 1001,
    date: "2026-09-26T14:00:00+00:00",
    referee: "M. Oliver",
    venue: { name: "Old Trafford", city: "Manchester" },
    status: { short: "FT", long: "Match Finished" },
  },
  league: { id: 39, season: 2026, round: "Regular Season - 6" },
  teams: { home: { id: 1, name: "Manchester United" }, away: { id: 6, name: "Arsenal" } },
  goals: { home: 2, away: 1 },
  score: { fulltime: { home: 2, away: 1 } },
  ...overrides,
});

describe("API-Football adapter", () => {
  it("resolves the current season with coverage, authenticating by header", async () => {
    const { source, calls } = apiFootball([
      json({
        errors: [],
        response: [
          {
            league: { id: 39, name: "Premier League", type: "League" },
            country: { name: "England" },
            seasons: [
              {
                year: 2026,
                start: "2026-08-21",
                end: "2027-05-30",
                current: true,
                coverage: { fixtures: { statistics_fixtures: true }, injuries: true },
              },
            ],
          },
        ],
      }),
    ]);
    const league = await source.fetchLeagueSeason(39);
    expect(league).toMatchObject({
      season: 2026,
      label: "2026/27",
      country: "England",
      coverage: { injuries: true, statistics: true },
    });
    expect(calls[0]!.url).toBe("https://v3.football.api-sports.io/leagues?id=39&current=true");
    expect(calls[0]!.headers["x-apisports-key"]).toBe(KEY);
  });

  it.each([
    [{ token: "Error/Missing application key." }, "auth"],
    [{ plan: "Free plans do not have access to this season, try from 2021 to 2023." }, "auth"],
    [{ requests: "You have reached the request limit for the day." }, "budget_exhausted"],
    [{ rateLimit: "Too many requests." }, "rate_limited"],
    [{ season: "The Season field must contain 4 characters." }, "invalid_response"],
  ])("maps the errors object %j to %s", async (errors, kind) => {
    const { source } = apiFootball([json({ errors, response: [] })]);
    const error = await source.fetchTeams(39, 2026).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe(kind);
    expect((error as ProviderError).message).not.toContain(KEY);
  });

  it("maps fixtures to 90-minute results and platform statuses", async () => {
    const { source } = apiFootball([
      json({
        errors: [],
        response: [
          fixtureItem(),
          fixtureItem({
            fixture: { id: 1002, date: "2026-09-27T15:30:00+00:00", status: { short: "AET" } },
            goals: { home: 3, away: 2 },
            score: { fulltime: { home: 2, away: 2 } },
          }),
          fixtureItem({
            fixture: { id: 1003, date: "2026-10-03T14:00:00+00:00", status: { short: "NS" } },
            goals: { home: null, away: null },
            score: { fulltime: { home: null, away: null } },
          }),
          fixtureItem({
            fixture: { id: 1004, date: "2026-10-04T14:00:00Z", status: { short: "XYZ" } },
          }),
          fixtureItem({
            fixture: { id: 1005, date: "2026-10-04T14:00:00Z", status: { short: "FT" } },
            goals: { home: null, away: null },
            score: { fulltime: null },
          }),
        ],
      }),
    ]);
    const { fixtures, skipped } = await source.fetchFixtures(39, 2026);
    expect(skipped).toBe(2);
    expect(fixtures.map((f) => [f.id, f.status, f.score])).toEqual([
      [1001, "finished", { home: 2, away: 1 }],
      [1002, "finished", { home: 2, away: 2 }],
      [1003, "scheduled", null],
    ]);
    expect(fixtures[0]).toMatchObject({ matchday: 6, venue: "Old Trafford" });
    expect(["PST", "CANC", "AWD", "HT"].map(mapFixtureStatus)).toEqual([
      "postponed",
      "cancelled",
      "cancelled",
      "live",
    ]);
  });

  it("reads expected goals for up to 20 fixtures per request", async () => {
    const { source, calls } = apiFootball([
      json({
        errors: [],
        response: [
          fixtureItem({
            statistics: [
              { team: { id: 1 }, statistics: [{ type: "expected_goals", value: "1.84" }] },
              { team: { id: 6 }, statistics: [{ type: "expected_goals", value: "0.9" }] },
            ],
          }),
        ],
      }),
    ]);
    const xg = await source.fetchExpectedGoals([1001, 1002]);
    expect(calls[0]!.url).toContain("ids=1001-1002");
    expect(xg.get(1001)).toEqual({ home: 1.84, away: 0.9 });
    expect(xg.get(1002)).toBeNull();
    await expect(
      source.fetchExpectedGoals(Array.from({ length: 21 }, (_, i) => i)),
    ).rejects.toThrow(/At most 20/);
  });

  it("counts players ruled out and doubtful per side", async () => {
    const { source } = apiFootball([
      json({
        errors: [],
        response: [
          { player: { type: "Missing Fixture" }, team: { id: 1 } },
          { player: { type: "Missing Fixture" }, team: { id: 1 } },
          { player: { type: "Questionable" }, team: { id: 6 } },
          { player: { type: "Missing Fixture" }, team: { id: 99 } },
        ],
      }),
    ]);
    const availability = await source.fetchAvailability({
      id: 1001,
      home: { id: 1, name: "" },
      away: { id: 6, name: "" },
    });
    expect(availability).toEqual({
      home: { out: 2, doubtful: 0 },
      away: { out: 0, doubtful: 1 },
    });
  });

  it("formats seasons, matchdays, short names and codes", () => {
    expect(seasonLabel(2026, "2026-08-21", "2027-05-30")).toBe("2026/27");
    expect(seasonLabel(2026, "2026-02-21", "2026-11-30")).toBe("2026");
    expect(previousSeasonLabel({ season: 2026, label: "2026/27" })).toBe("2025/26");
    expect(previousSeasonLabel({ season: 2026, label: "2026" })).toBe("2025");
    expect(parseMatchday("Regular Season - 12")).toBe(12);
    expect(parseMatchday("Final")).toBeNull();
    const names = deriveShortNames(FAKE_TEAMS.map((team) => team.name));
    expect(names.get("Manchester United")).toBe("Manchester United");
    expect(names.get("Manchester City")).toBe("Manchester City");
    expect(names.get("Wolverhampton Wanderers")).toBe("Wolverhampton");
    expect(names.get("AFC Bournemouth")).toBe("Bournemouth");
    expect(names.get("Brighton & Hove Albion")).toBe("Brighton");
    expect(deriveCode(null, "Bournemouth")).toBe("BOU");
    expect(deriveCode("mun", "Manchester United")).toBe("MUN");
  });
});

describe("football ingestion", () => {
  // Wednesday 30 September 2026, 12:00 UTC.
  const NOW = new Date("2026-09-30T12:00:00Z");
  const context = (overrides: Partial<IngestionContext> = {}): IngestionContext => ({
    now: () => NOW,
    dryRun: false,
    outOfTime: () => false,
    ...overrides,
  });

  function setup() {
    const source = new FakeFootballSource();
    source.seasons.set(2026, fakeSeason(FAKE_TEAMS, "2026-08-15", NOW));
    source.seasons.set(
      2025,
      fakeSeason(FAKE_TEAMS.slice(0, 4).concat(FAKE_TEAMS.slice(4)), "2025-08-16", NOW, 5000),
    );
    const repository = new MemorySportsRepository();
    return { source, repository, options: { source, repository, leagues: [39] } };
  }

  it("stores the season, last season's results as priors, availability and expected goals", async () => {
    const { source, repository, options } = setup();
    const result = await ingestFootball(options, context());
    const item = result.items[0]!;
    expect(item).toMatchObject({
      key: competitionKey(39),
      status: "updated",
      label: "Premier League 2026/27",
    });

    expect([...repository.competitions.keys()].sort()).toEqual([
      "apif-l39:2025/26",
      "apif-l39:2026/27",
    ]);
    const current = [...repository.fixtures.values()].filter(
      (f) => f.competitionId === "apif-l39:2026/27",
    );
    expect(current).toHaveLength(30);
    expect(repository.teams.get(teamKey(3))).toMatchObject({
      shortName: "Wolverhampton",
      code: "WOL",
      competitionId: "apif-l39:2026/27",
    });

    // Availability only for fixtures in the next seven days.
    const upcoming = current.filter((f) => f.context.availability);
    expect(upcoming.length).toBeGreaterThan(0);
    for (const fixture of upcoming) {
      expect(Date.parse(fixture.kickoffAt) - NOW.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
    }
    // xG checked for every finished fixture; stored where the provider has it.
    const finished = current.filter((f) => f.status === "finished");
    expect(finished.every((f) => f.context.xgChecked === true)).toBe(true);
    expect(repository.fixtures.get(matchRef(12))?.context.xg).toBeNull();
    expect(repository.fixtures.get(matchRef(11))?.context.xg).toEqual({ home: 1.2, away: 0.8 });
    expect(result.requestCount).toBe(source.requestCount);
  });

  it("only writes changed fixtures and never re-fetches last season or checked xG", async () => {
    const { source, repository, options } = setup();
    await ingestFootball(options, context());
    const writes = repository.fixtureWrites;
    source.calls = [];
    const again = await ingestFootball(options, context());
    expect(repository.fixtureWrites).toBe(writes);
    expect(source.calls.some((call) => call.startsWith("fixtures:2025"))).toBe(false);
    expect(source.calls.some((call) => call.startsWith("xg:"))).toBe(false);
    expect(source.calls.includes("teams")).toBe(false);
    expect(again.items[0]?.rowsWritten).toBe(0);
  });

  it("keeps going with neutral priors when the plan excludes last season", async () => {
    const { source, repository, options } = setup();
    source.previousSeasonError = new ProviderError("api-football", "plan", { kind: "auth" });
    const result = await ingestFootball(options, context());
    expect(result.items[0]?.status).toBe("updated");
    expect(result.items[0]?.warnings?.join(" ")).toMatch(/neutral priors/);
    expect([...repository.competitions.keys()]).toEqual(["apif-l39:2026/27"]);
  });

  it("keeps a league whose optional enrichment fails, with a warning", async () => {
    const { source, repository, options } = setup();
    source.availabilityError = new ProviderError("api-football", "/injuries responded 500", {
      status: 500,
    });
    const result = await ingestFootball(options, context());
    expect(result.items[0]?.status).toBe("updated");
    expect(result.items[0]?.warnings?.join(" ")).toMatch(/Availability incomplete/);
    // Fixtures and expected goals were still stored.
    expect([...repository.fixtures.values()].some((f) => f.context.xgChecked === true)).toBe(true);

    source.availabilityError = new ProviderError("api-football", "bad key", { kind: "auth" });
    await expect(ingestFootball(options, context())).rejects.toThrow(/bad key/);
  });

  it("aborts on authentication errors and skips leagues once the budget is spent", async () => {
    const auth = setup();
    auth.source.leagueError = new ProviderError("api-football", "invalid key", { kind: "auth" });
    await expect(ingestFootball(auth.options, context())).rejects.toThrow(/invalid key/);

    const budget = setup();
    budget.source.budget = 3;
    const result = await ingestFootball({ ...budget.options, leagues: [39, 140] }, context());
    expect(result.items.map((item) => item.status)).toEqual(["updated", "skipped"]);
  });

  it("writes nothing on a dry run", async () => {
    const { repository, options } = setup();
    const result = await ingestFootball(options, context({ dryRun: true }));
    expect(result.items[0]?.detail).toMatch(/Dry run: 30 fixtures/);
    expect(repository.competitions.size).toBe(0);
  });
});
