import { describe, expect, it } from "vitest";

import { predictMatch } from "@/lib/sports/football-model";
import { buildScoreMatrix } from "@/lib/sports/poisson";
import { DemoSportsDataProvider } from "@/lib/sports/providers/demo-provider";
import {
  defaultZones,
  simulateSeason,
  type SimulationFixture,
  type SimulationTeam,
} from "@/lib/sports/season-simulation";
import { powerRating, teamStrengths } from "@/lib/sports/team-strength";

const team = (key: string): SimulationTeam => ({
  key,
  name: key.toUpperCase(),
  shortName: key,
  code: key.toUpperCase(),
});
const teams = ["a", "b", "c", "d"].map(team);
const fixture = (id: string, homeKey: string, awayKey: string, lh = 1.4, la = 1.1) => ({
  id,
  homeKey,
  awayKey,
  kickoffAt: `2026-10-0${id.length}T15:00:00.000Z`,
  scoreMatrix: buildScoreMatrix(lh, la, { rho: -0.06 }).probabilities,
});

describe("season simulation", () => {
  // a and b level at the top, c and d well behind.
  const finished = [
    { homeKey: "a", awayKey: "c", homeGoals: 2, awayGoals: 0 },
    { homeKey: "b", awayKey: "d", homeGoals: 2, awayGoals: 0 },
    { homeKey: "c", awayKey: "d", homeGoals: 0, awayGoals: 0 },
  ];
  const remaining: SimulationFixture[] = [
    fixture("1", "a", "b"),
    fixture("22", "c", "a"),
    fixture("333", "d", "b"),
  ];
  const run = (seed = "test") =>
    simulateSeason({ teams, finished, remaining, seed, simulations: 4000 });

  it("produces coherent position distributions", () => {
    const projection = run();
    expect(projection.simulations).toBe(4000);
    for (const entry of projection.teams) {
      expect(entry.positionProbabilities.reduce((total, p) => total + p, 0)).toBeCloseTo(1, 3);
      expect(entry.expectedPoints).toBeGreaterThanOrEqual(entry.currentPoints);
      expect(entry.expectedPoints).toBeLessThanOrEqual(entry.currentPoints + 3 * entry.remaining);
      expect(entry.pointsP10).toBeLessThanOrEqual(entry.pointsP90);
    }
    for (let position = 0; position < teams.length; position++) {
      const total = projection.teams.reduce(
        (sum, entry) => sum + entry.positionProbabilities[position]!,
        0,
      );
      expect(total).toBeCloseTo(1, 3);
    }
    expect(projection.teams.reduce((sum, entry) => sum + entry.title, 0)).toBeCloseTo(1, 3);
    expect(
      projection.teams
        .slice(0, 2)
        .map((entry) => entry.team.key)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("is deterministic for a seed", () => {
    expect(run("same")).toEqual(run("same"));
    expect(run("same").teams[0]!.title).not.toBe(run("other").teams[0]!.title);
  });

  it("identifies the head-to-head as the most decisive fixture", () => {
    const [first] = run().decisive;
    expect(first?.id).toBe("1");
    expect(["a", "b"]).toContain(first!.teamKey);
    // A home win helps the home side's title chances and hurts the visitor's.
    const [winner, loser] =
      first!.teamKey === "a"
        ? [first!.ifHomeWin, first!.ifAwayWin]
        : [first!.ifAwayWin, first!.ifHomeWin];
    expect(winner).toBeGreaterThan(loser);
    expect(first!.swing).toBeGreaterThan(0.5);
  });

  it("reproduces the current table when the season is over", () => {
    const projection = simulateSeason({ teams, finished, remaining: [], seed: "done" });
    expect(projection.simulations).toBe(1);
    expect(projection.decisive).toEqual([]);
    const c = projection.teams.find((entry) => entry.team.key === "c")!;
    expect(c.currentPosition).toBe(3);
    expect(c.expectedPoints).toBe(1);
  });

  it("follows the model's score matrices", () => {
    const lopsided = simulateSeason({
      teams,
      finished: [],
      remaining: [fixture("1", "a", "b", 3.5, 0.3), fixture("22", "c", "d", 0.3, 3.5)],
      seed: "lopsided",
      simulations: 3000,
      zones: { top: 2, bottom: 1 },
    });
    const byKey = new Map(lopsided.teams.map((entry) => [entry.team.key, entry]));
    expect(byKey.get("a")!.top).toBeGreaterThan(0.8);
    expect(byKey.get("b")!.bottom + byKey.get("c")!.bottom).toBeGreaterThan(0.8);
  });

  it("sizes zones by league", () => {
    expect(defaultZones(20)).toEqual({ top: 4, bottom: 3 });
    expect(defaultZones(8)).toEqual({ top: 2, bottom: 1 });
  });
});

describe("team strength", () => {
  it("rates clubs from the model's pre-match inputs", async () => {
    const provider = new DemoSportsDataProvider(() => new Date("2026-09-25T12:00:00Z"));
    const [competition] = await provider.listCompetitions();
    const clubs = await provider.listTeams(competition!.key);
    const matches = await provider.listMatches({ competitionKey: competition!.key });
    const strengths = teamStrengths(clubs, matches);
    expect(strengths).toHaveLength(clubs.length);
    expect(strengths.map((entry) => entry.rank)).toEqual(clubs.map((_, i) => i + 1));
    for (let i = 1; i < strengths.length; i++) {
      expect(strengths[i]!.power).toBeLessThanOrEqual(strengths[i - 1]!.power);
    }
    const leader = strengths[0]!;
    const next = matches.find(
      (match) =>
        match.status === "scheduled" &&
        (match.homeTeam.key === leader.team.key || match.awayTeam.key === leader.team.key),
    )!;
    const inputs =
      next.homeTeam.key === leader.team.key ? next.modelInputs.home : next.modelInputs.away;
    expect(leader.attack).toBeCloseTo(inputs.attack, 4);
    expect(leader.power).toBeCloseTo(
      powerRating(next.modelInputs.leagueBaselineGoals, inputs.attack, inputs.defence),
      4,
    );
    expect(leader.history.length).toBeGreaterThan(5);
    expect(leader.trend).not.toBeNull();
  });

  it("feeds season projections from provider fixtures", async () => {
    const provider = new DemoSportsDataProvider(() => new Date("2026-09-25T12:00:00Z"));
    const [competition] = await provider.listCompetitions();
    const clubs = await provider.listTeams(competition!.key);
    const matches = await provider.listMatches({ competitionKey: competition!.key });
    const projection = simulateSeason({
      teams: clubs,
      finished: matches
        .filter((match) => match.status === "finished" && match.score)
        .map((match) => ({
          homeKey: match.homeTeam.key,
          awayKey: match.awayTeam.key,
          homeGoals: match.score!.home,
          awayGoals: match.score!.away,
        })),
      remaining: matches
        .filter((match) => match.status === "scheduled")
        .map((match) => ({
          id: match.id,
          homeKey: match.homeTeam.key,
          awayKey: match.awayTeam.key,
          kickoffAt: match.kickoffAt,
          scoreMatrix: predictMatch(match.modelInputs).scoreMatrix,
        })),
      seed: competition!.key,
      simulations: 3000,
    });
    expect(projection.remainingFixtures).toBeGreaterThan(0);
    expect(projection.teams).toHaveLength(clubs.length);
  });
});
