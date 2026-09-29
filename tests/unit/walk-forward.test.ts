import { describe, expect, it } from "vitest";

import { DataUnavailableError } from "@/lib/api/errors";
import { predictMatch } from "@/lib/sports/football-model";
import { competitionKey, matchRef, teamKey } from "@/lib/sports/ingestion";
import type { UpstreamFixture } from "@/lib/sports/providers/api-football";
import {
  buildFootballState,
  competitionShortName,
  StoredSportsDataProvider,
  type StoredFootballRows,
} from "@/lib/sports/providers/stored-provider";
import { estimateLeagueParameters, estimateTeamRatings } from "@/lib/sports/ratings";
import type { Team } from "@/lib/sports/types";
import {
  availabilityLevel,
  buildSeasonState,
  buildStandings,
  carryOverPriors,
  SEASON_CARRY_OVER,
  type SeasonFixture,
} from "@/lib/sports/walk-forward";
import { FAKE_TEAMS, fakeSeason } from "@/tests/helpers/sports-fakes";

const NOW = new Date("2026-09-30T12:00:00Z");

const team = (key: string): Team => ({
  key,
  name: key.toUpperCase(),
  shortName: key,
  code: key.slice(0, 3).toUpperCase(),
  city: "",
  venue: `${key} ground`,
  competitionKey: "test",
});

const fixture = (
  id: string,
  kickoffAt: string,
  homeKey: string,
  awayKey: string,
  score: [number, number] | null,
  extra: Partial<SeasonFixture> = {},
): SeasonFixture => ({
  id,
  kickoffAt,
  status: score ? "finished" : "scheduled",
  round: 1,
  venue: null,
  homeKey,
  awayKey,
  score: score ? { home: score[0], away: score[1] } : null,
  xg: null,
  availability: null,
  ...extra,
});

const COMPETITION = {
  key: "test",
  sportKey: "football",
  name: "Test League",
  shortName: "TL",
  region: "Test",
  season: "2026/27",
  baselineGoals: 1.35,
  homeAdvantage: 1.25,
};

function seasonRows(
  fixtures: UpstreamFixture[],
  competitionId: string,
): StoredFootballRows["matches"] {
  return fixtures.map((f) => ({
    externalRef: matchRef(f.id),
    competitionId,
    homeTeamKey: teamKey(f.home.id),
    awayTeamKey: teamKey(f.away.id),
    kickoffAt: f.kickoffAt,
    status: f.status,
    matchday: f.matchday,
    venue: f.venue,
    homeScore: f.score?.home ?? null,
    awayScore: f.score?.away ?? null,
    context: f.status === "finished" ? { xg: { home: 1.4, away: 1.1 }, xgChecked: true } : {},
    updatedAt: NOW.toISOString(),
  }));
}

function storedRows(options: { previous?: boolean } = {}): StoredFootballRows {
  const key = competitionKey(39);
  const current = fakeSeason(FAKE_TEAMS, "2026-08-15", NOW);
  const previous = fakeSeason(FAKE_TEAMS, "2025-08-16", NOW, 5000);
  return {
    competitions: [
      {
        id: "c-26",
        key,
        name: "Premier League",
        region: "England",
        season: "2026/27",
        baselineGoals: 1.35,
        homeAdvantage: 1.25,
      },
      ...(options.previous
        ? [
            {
              id: "c-25",
              key,
              name: "Premier League",
              region: "England",
              season: "2025/26",
              baselineGoals: 1.35,
              homeAdvantage: 1.25,
            },
          ]
        : []),
    ],
    teams: FAKE_TEAMS.map((t) => ({
      key: teamKey(t.id),
      name: t.name,
      shortName: t.name.split(" ")[0]!,
      code: t.code ?? "XXX",
      city: t.city,
      venue: t.venue,
    })),
    matches: [
      ...seasonRows(current, "c-26"),
      ...(options.previous ? seasonRows(previous, "c-25") : []),
    ],
  };
}

describe("walk-forward season state", () => {
  const teams = ["a", "b", "c", "d"].map(team);
  const fixtures = [
    fixture("m1", "2026-08-15T11:30:00.000Z", "a", "b", [3, 0]),
    fixture("m2", "2026-08-15T12:00:00.000Z", "c", "d", [1, 1]),
    fixture("m3", "2026-08-15T16:30:00.000Z", "a", "c", [2, 2]),
    fixture("m4", "2026-08-22T14:00:00.000Z", "b", "d", [0, 1]),
    fixture("m5", "2026-10-03T14:00:00.000Z", "d", "a", null, {
      availability: { home: { out: 4, doubtful: 2 }, away: { out: 0, doubtful: 1 } },
    }),
  ];
  const state = buildSeasonState({ competition: COMPETITION, teams, fixtures }, NOW);
  const byId = new Map(state.matches.map((match) => [match.id, match]));

  it("only uses results final before each kick-off", () => {
    // m1 (11:30) is final by 13:20 — visible to m3 (16:30) but not to m2 (12:00).
    expect(byId.get("m2")!.context.home.form).toEqual([]);
    expect(byId.get("m3")!.context.home.form).toEqual(["W"]);
    expect(byId.get("m3")!.context.away.form).toEqual(["D"]);
  });

  it("is invariant to later results (no look-ahead)", () => {
    const changed = fixtures.map((f) =>
      f.id === "m4"
        ? { ...f, score: { home: 7, away: 0 } }
        : f.id === "m3"
          ? { ...f, score: { home: 0, away: 5 } }
          : f,
    );
    const again = buildSeasonState({ competition: COMPETITION, teams, fixtures: changed }, NOW);
    const m3Before = byId.get("m3")!;
    const m3After = again.matches.find((match) => match.id === "m3")!;
    // m3's own result and later results do not leak into its pre-match inputs.
    expect(m3After.modelInputs).toEqual(m3Before.modelInputs);
    expect(again.matches.find((m) => m.id === "m1")!.modelInputs).toEqual(
      byId.get("m1")!.modelInputs,
    );
    // …but they do feed later fixtures.
    expect(again.matches.find((m) => m.id === "m5")!.modelInputs).not.toEqual(
      byId.get("m5")!.modelInputs,
    );
  });

  it("derives rest days, availability and table position", () => {
    const m4 = byId.get("m4")!;
    expect(m4.context.home.restDays).toBe(7);
    expect(byId.get("m1")!.context.home.restDays).toBeNull();
    const m5 = byId.get("m5")!;
    expect(m5.context.home.injuries).toBe("moderate");
    expect(m5.context.away.injuries).toBe("none");
    expect(m5.context.away.leaguePosition).toBe(1);
    expect(state.standings[0]).toMatchObject({ team: { key: "a" }, points: 4, played: 2 });
  });

  it("produces coherent probabilities for every fixture", () => {
    for (const match of state.matches) {
      const prediction = predictMatch(match.modelInputs);
      expect(
        prediction.outcome.home + prediction.outcome.draw + prediction.outcome.away,
      ).toBeCloseTo(1, 9);
    }
    expect(state.competition.teamCount).toBe(4);
  });

  it("maps availability counts to the model's scale", () => {
    expect(
      [
        { out: 0, doubtful: 1 },
        { out: 1, doubtful: 0 },
        { out: 2, doubtful: 2 },
        { out: 6, doubtful: 0 },
      ].map(availabilityLevel),
    ).toEqual(["none", "minor", "moderate", "major"]);
  });

  it("builds standings with the usual tie-breakers", () => {
    const table = buildStandings(teams, [
      { homeKey: "a", awayKey: "b", home: 1, away: 0 },
      { homeKey: "c", awayKey: "d", home: 3, away: 0 },
    ]);
    expect(table.map((row) => row.team.key)).toEqual(["c", "a", "b", "d"]);
  });
});

describe("season-to-season priors", () => {
  const results = Array.from({ length: 30 }, (_, i) => ({
    homeTeam: ["a", "b", "c"][i % 3]!,
    awayTeam: ["b", "c", "a"][i % 3]!,
    homeGoals: ["a", "b", "c"][i % 3] === "a" ? 3 : 1,
    awayGoals: ["b", "c", "a"][i % 3] === "a" ? 2 : 1,
  }));

  it("regresses last season's ratings and seeds promoted clubs from departed ones", () => {
    const { priors, league } = carryOverPriors(
      { teams: ["a", "b", "c"], results },
      ["a", "b", "z"],
      { baselineGoals: 1.35, homeAdvantage: 1.25 },
    );
    const lastSeason = estimateTeamRatings(
      ["a", "b", "c"],
      results,
      estimateLeagueParameters(results, { baselineGoals: 1.35, homeAdvantage: 1.25 }),
      {},
    );
    // Strong clubs stay strong but regress toward average: prior = rating^0.7.
    expect(priors.a!.attack).toBeGreaterThan(1);
    expect(priors.a!.attack).toBeCloseTo(lastSeason.a!.attack ** SEASON_CARRY_OVER, 10);
    // "z" replaces "c": it inherits c's (regressed) strength.
    expect(priors.z!.attack).toBeCloseTo(lastSeason.c!.attack ** SEASON_CARRY_OVER, 10);
    expect(league.baselineGoals).toBeGreaterThan(0);
  });

  it("falls back to neutral priors without history", () => {
    expect(carryOverPriors(null, ["a"], { baselineGoals: 1.3, homeAdvantage: 1.2 })).toEqual({
      priors: {},
      league: { baselineGoals: 1.3, homeAdvantage: 1.2 },
    });
  });
});

describe("StoredSportsDataProvider", () => {
  const provider = (rows: StoredFootballRows) =>
    new StoredSportsDataProvider({
      id: "api-football",
      displayName: "API-Football",
      competitionKeys: [competitionKey(39)],
      load: async () => rows,
      clock: () => NOW,
    });

  it("serves competitions, fixtures, matches and standings from stored rows", async () => {
    const store = provider(storedRows());
    const [competition] = await store.listCompetitions("football");
    expect(competition).toMatchObject({
      key: "apif-l39",
      shortName: "PL",
      season: "2026/27",
      teamCount: 6,
    });
    const upcoming = await store.listMatches({ status: ["scheduled"], limit: 3 });
    expect(upcoming).toHaveLength(3);
    expect(upcoming.every((match) => match.kickoffAt > NOW.toISOString())).toBe(true);
    const finished = await store.listMatches({ status: ["finished"] });
    expect(finished.every((match) => match.xg !== null && match.score !== null)).toBe(true);
    const match = await store.getMatch(finished[0]!.id.toUpperCase());
    expect(match?.id).toBe(finished[0]!.id);
    expect(
      (await store.getStandings("apif-l39")).reduce((total, row) => total + row.played, 0),
    ).toBe(finished.length * 2);
    expect(store.isSimulated).toBe(false);
  });

  it("uses last season as priors for the opening fixtures", () => {
    const neutral = buildFootballState(storedRows(), ["apif-l39"], NOW);
    const primed = buildFootballState(storedRows({ previous: true }), ["apif-l39"], NOW);
    const first = (state: typeof neutral) => state.seasons[0]!.matches[0]!.context.home;
    expect(first(neutral).attackRating).toBe(1);
    expect(first(primed).attackRating).not.toBe(1);
  });

  it("reports that nothing has been ingested yet", async () => {
    const store = provider({ competitions: [], teams: [], matches: [] });
    await expect(store.listCompetitions()).rejects.toBeInstanceOf(DataUnavailableError);
    await expect(store.getMatch("apif-1")).resolves.toBeNull();
  });

  it("abbreviates competition names", () => {
    expect(
      ["Premier League", "Bundesliga", "Ligue 1", "Serie A"].map(competitionShortName),
    ).toEqual(["PL", "BUN", "L1", "SA"]);
  });
});
