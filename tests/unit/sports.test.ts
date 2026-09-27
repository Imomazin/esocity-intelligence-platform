import { describe, expect, it } from "vitest";

import { evaluateSportsModel, multiclassBrier } from "@/lib/sports/evaluation";
import { computeUncertaintyScore, formModifier, predictMatch } from "@/lib/sports/football-model";
import {
  buildScoreMatrix,
  cleanSheetProbabilities,
  normaliseProbabilities,
  outcomeProbabilities,
  poissonPmf,
  probabilityBothTeamsScore,
  probabilityTotalOver,
  topScorelines,
} from "@/lib/sports/poisson";
import { DemoSportsDataProvider } from "@/lib/sports/providers/demo-provider";
import { estimateLeagueParameters, estimateTeamRatings } from "@/lib/sports/ratings";
import type { MatchModelInputs } from "@/lib/sports/types";

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe("Poisson primitives", () => {
  it("matches the closed-form pmf", () => {
    let factorial = 1;
    for (let k = 0; k < 8; k++) {
      if (k > 0) factorial *= k;
      expect(poissonPmf(k, 1.4)).toBeCloseTo((Math.exp(-1.4) * 1.4 ** k) / factorial, 12);
    }
  });

  it("builds a renormalised 0–6 matrix whose derived markets are coherent", () => {
    const matrix = buildScoreMatrix(1.6, 1.1, { rho: -0.06 });
    expect(matrix.probabilities).toHaveLength(7);
    expect(sum(matrix.probabilities.flat())).toBeCloseTo(1, 12);
    expect(matrix.truncatedMass).toBeGreaterThan(0);
    const outcome = outcomeProbabilities(matrix);
    expect(outcome.home + outcome.draw + outcome.away).toBeCloseTo(1, 12);
    const cleanSheets = cleanSheetProbabilities(matrix);
    const p00 = matrix.probabilities[0]![0]!;
    expect(probabilityBothTeamsScore(matrix)).toBeCloseTo(
      1 - cleanSheets.home - cleanSheets.away + p00,
      12,
    );
    expect(probabilityTotalOver(matrix, 2.5)).toBeLessThan(probabilityTotalOver(matrix, 1.5));
    const lines = topScorelines(matrix, 5).map((line) => line.probability);
    expect(lines).toEqual([...lines].sort((a, b) => b - a));
  });

  it("negative ρ inflates draws; the τ correction preserves total mass", () => {
    const independent = outcomeProbabilities(buildScoreMatrix(1.2, 1.2, { rho: 0 }));
    const dependent = outcomeProbabilities(buildScoreMatrix(1.2, 1.2, { rho: -0.1 }));
    expect(dependent.draw).toBeGreaterThan(independent.draw);
    expect(buildScoreMatrix(1.2, 1.2, { rho: -0.1 }).truncatedMass).toBeCloseTo(
      buildScoreMatrix(1.2, 1.2, { rho: 0 }).truncatedMass,
      12,
    );
  });

  it("normalises weights to exactly one and rejects invalid λ", () => {
    expect(sum(normaliseProbabilities([2, 1, 1]))).toBe(1);
    expect(normaliseProbabilities([0, 0])).toEqual([0.5, 0.5]);
    expect(() => buildScoreMatrix(0, 1)).toThrow();
  });
});

describe("football model", () => {
  const inputs: MatchModelInputs = {
    home: {
      attack: 1.2,
      defence: 0.9,
      form: ["W", "W", "D"],
      xgFor: 1.8,
      xgAgainst: 1,
      restDays: 6,
    },
    away: {
      attack: 0.9,
      defence: 1.1,
      form: ["L", "D", "L"],
      xgFor: 1.1,
      xgAgainst: 1.5,
      restDays: 6,
    },
    leagueBaselineGoals: 1.38,
    homeAdvantage: 1.25,
  };

  it("produces probabilities that sum to one across every market", () => {
    const p = predictMatch(inputs);
    expect(p.outcome.home + p.outcome.draw + p.outcome.away).toBeCloseTo(1, 12);
    expect(p.markets.over25 + p.markets.under25).toBeCloseTo(1, 12);
    expect(p.markets.bttsYes + p.markets.bttsNo).toBeCloseTo(1, 12);
    expect(sum(p.scoreMatrix.flat())).toBeCloseTo(1, 12);
    expect(p.mostLikelyOutcome).toBe("HOME");
    expect(p.confidence).toBeLessThanOrEqual(0.9);
  });

  it("is symmetric without home advantage and favours the home side with it", () => {
    const even = { attack: 1, defence: 1 };
    const neutral = predictMatch({ ...inputs, home: even, away: even, homeAdvantage: 1 });
    expect(neutral.outcome.home).toBeCloseTo(neutral.outcome.away, 12);
    const withEdge = predictMatch({ ...inputs, home: even, away: even, homeAdvantage: 1.3 });
    expect(withEdge.outcome.home).toBeGreaterThan(withEdge.outcome.away);
  });

  it("explains λ through its factors", () => {
    const p = predictMatch(inputs);
    const product = (side: "home" | "away") =>
      p.factors.reduce((acc, factor) => acc * factor[side], 1);
    expect(product("home")).toBeCloseTo(p.lambdaHome, 2);
    expect(product("away")).toBeCloseTo(p.lambdaAway, 2);
  });

  it("bounds form and grades uncertainty", () => {
    expect(formModifier(["W", "W", "W", "W", "W"])).toBeCloseTo(1.08);
    expect(formModifier(["L", "L", "L", "L", "L"])).toBeCloseTo(0.92);
    expect(computeUncertaintyScore(1, 1)).toBe(100);
    expect(computeUncertaintyScore(0.5, 1)).toBe(0);
  });
});

describe("ratings and evaluation", () => {
  it("recovers a stronger attack from results, shrunk toward the prior", () => {
    const results = Array.from({ length: 30 }, (_, i) => ({
      homeTeam: i % 2 === 0 ? "A" : "B",
      awayTeam: i % 2 === 0 ? "B" : "A",
      homeGoals: i % 2 === 0 ? 3 : 1,
      awayGoals: i % 2 === 0 ? 1 : 2,
    }));
    const league = estimateLeagueParameters(results, { baselineGoals: 1.4, homeAdvantage: 1.25 });
    expect(league.homeAdvantage).toBeGreaterThan(1);
    const ratings = estimateTeamRatings(["A", "B"], results, league, {});
    expect(ratings.A!.attack).toBeGreaterThan(ratings.B!.attack);
  });

  it("scores Brier correctly and evaluates only finished matches", async () => {
    expect(multiclassBrier({ home: 1, draw: 0, away: 0 }, "HOME")).toBe(0);
    expect(multiclassBrier({ home: 0, draw: 0, away: 1 }, "HOME")).toBe(2);
    const provider = new DemoSportsDataProvider(() => new Date("2026-09-25T12:00:00Z"));
    const matches = await provider.listMatches();
    const evaluation = evaluateSportsModel(matches);
    expect(evaluation.matches).toBe(matches.filter((m) => m.status === "finished").length);
    expect(evaluation.accuracy).toBeGreaterThan(0.33);
  });

  it("builds pre-match inputs without using the match result", async () => {
    const provider = new DemoSportsDataProvider(() => new Date("2026-09-25T12:00:00Z"));
    const finished = (await provider.listMatches()).find((match) => match.status === "finished")!;
    const later = new DemoSportsDataProvider(() => new Date("2026-11-25T12:00:00Z"));
    const same = await later.getMatch(finished.id);
    // More results later in the season must not change an already-played match's inputs.
    expect(same?.modelInputs).toEqual(finished.modelInputs);
  });
});
