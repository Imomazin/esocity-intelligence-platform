import { createRng } from "@/lib/quant/random";
import { round } from "@/lib/quant/stats";

/**
 * Season projections by Monte Carlo (model key: sports.season-simulator).
 *
 * Every remaining fixture is played thousands of times by sampling a scoreline from the football
 * model's own score matrix (so goal difference — the first tie-breaker — is simulated too).
 * Final tables rank by points, goal difference, goals scored, then drawing lots. The result is a
 * distribution of finishing positions for every club, plus the fixtures whose result moves the
 * title race the most.
 *
 * Ratings are held at their current estimates for the rest of the season — the simulation does
 * not model uncertainty in the ratings themselves, so early-season projections are somewhat
 * too confident. Deterministic for a given seed.
 */

export const SEASON_SIMULATION_VERSION = "1.0.0";
export const DEFAULT_SIMULATIONS = 10_000;
const MIN_SIMULATIONS = 2_000;
/** Caps simulations × remaining fixtures so a full early-season run stays fast. */
const MAX_FIXTURE_DRAWS = 3_000_000;
const DECISIVE_LIMIT = 5;
const MIN_SWING = 0.02;

export interface SimulationTeam {
  key: string;
  name: string;
  shortName: string;
  code: string;
}

export interface SimulationResult {
  homeKey: string;
  awayKey: string;
  homeGoals: number;
  awayGoals: number;
}

export interface SimulationFixture {
  id: string;
  homeKey: string;
  awayKey: string;
  kickoffAt: string;
  /** scoreMatrix[h][a] = P(home h, away a); rows sum (with columns) to 1. */
  scoreMatrix: readonly (readonly number[])[];
}

export interface SeasonZones {
  top: number;
  bottom: number;
}

export interface TeamProjection {
  team: SimulationTeam;
  played: number;
  remaining: number;
  currentPoints: number;
  currentPosition: number;
  expectedPoints: number;
  pointsP10: number;
  pointsP90: number;
  expectedPosition: number;
  /** positionProbabilities[k] = P(finishing in position k + 1). */
  positionProbabilities: number[];
  title: number;
  top: number;
  bottom: number;
}

export interface DecisiveFixture {
  id: string;
  homeKey: string;
  awayKey: string;
  kickoffAt: string;
  /** Club whose title probability depends most on this result. */
  teamKey: string;
  ifHomeWin: number;
  ifDraw: number;
  ifAwayWin: number;
  /** max − min of the conditional title probabilities. */
  swing: number;
}

export interface SeasonProjection {
  simulations: number;
  remainingFixtures: number;
  zones: SeasonZones;
  /** Sorted by expected finishing position. */
  teams: TeamProjection[];
  decisive: DecisiveFixture[];
  seed: string;
}

/** Zone sizes by league size (neutral labels: "Top n" and "Bottom n"). */
export function defaultZones(teamCount: number): SeasonZones {
  if (teamCount >= 18) return { top: 4, bottom: 3 };
  if (teamCount >= 12) return { top: 4, bottom: 2 };
  return { top: 2, bottom: 1 };
}

interface TableRow {
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  played: number;
}

function applyResult(
  table: TableRow[],
  home: number,
  away: number,
  homeGoals: number,
  awayGoals: number,
) {
  const h = table[home] as TableRow;
  const a = table[away] as TableRow;
  h.played += 1;
  a.played += 1;
  h.goalsFor += homeGoals;
  h.goalsAgainst += awayGoals;
  a.goalsFor += awayGoals;
  a.goalsAgainst += homeGoals;
  if (homeGoals > awayGoals) h.points += 3;
  else if (homeGoals < awayGoals) a.points += 3;
  else {
    h.points += 1;
    a.points += 1;
  }
}

/** Indices of teams in table order; `lots` breaks remaining ties. */
function rankTable(table: readonly TableRow[], lots: readonly number[]): number[] {
  return table
    .map((_, i) => i)
    .sort((i, j) => {
      const a = table[i] as TableRow;
      const b = table[j] as TableRow;
      return (
        b.points - a.points ||
        b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
        b.goalsFor - a.goalsFor ||
        (lots[i] as number) - (lots[j] as number)
      );
    });
}

interface PreparedFixture {
  fixture: SimulationFixture;
  home: number;
  away: number;
  cdf: Float64Array;
  width: number;
}

function prepare(fixture: SimulationFixture, index: Map<string, number>): PreparedFixture | null {
  const home = index.get(fixture.homeKey);
  const away = index.get(fixture.awayKey);
  if (home === undefined || away === undefined) return null;
  const width = fixture.scoreMatrix[0]?.length ?? 0;
  const cells = fixture.scoreMatrix.length * width;
  const cdf = new Float64Array(cells);
  let total = 0;
  fixture.scoreMatrix.forEach((row, h) =>
    row.forEach((p, a) => {
      total += p;
      cdf[h * width + a] = total;
    }),
  );
  for (let i = 0; i < cells; i++) cdf[i] = (cdf[i] as number) / total;
  return { fixture, home, away, cdf, width };
}

function sampleCell(cdf: Float64Array, u: number): number {
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((cdf[mid] as number) < u) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function simulateSeason(input: {
  teams: readonly SimulationTeam[];
  finished: readonly SimulationResult[];
  remaining: readonly SimulationFixture[];
  seed: string;
  simulations?: number;
  zones?: SeasonZones;
}): SeasonProjection {
  const teams = [...input.teams];
  const n = teams.length;
  const index = new Map(teams.map((team, i) => [team.key, i]));
  const zones = input.zones ?? defaultZones(n);

  const base: TableRow[] = teams.map(() => ({
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    played: 0,
  }));
  for (const result of input.finished) {
    const home = index.get(result.homeKey);
    const away = index.get(result.awayKey);
    if (home === undefined || away === undefined) continue;
    applyResult(base, home, away, result.homeGoals, result.awayGoals);
  }
  const fixtures = input.remaining
    .map((fixture) => prepare(fixture, index))
    .filter((fixture): fixture is PreparedFixture => fixture !== null);
  const remainingByTeam = new Array(n).fill(0) as number[];
  for (const fixture of fixtures) {
    remainingByTeam[fixture.home] = (remainingByTeam[fixture.home] as number) + 1;
    remainingByTeam[fixture.away] = (remainingByTeam[fixture.away] as number) + 1;
  }

  const requested = input.simulations ?? DEFAULT_SIMULATIONS;
  const simulations =
    fixtures.length === 0
      ? 1
      : Math.max(
          Math.min(requested, MIN_SIMULATIONS),
          Math.min(requested, Math.floor(MAX_FIXTURE_DRAWS / fixtures.length)),
        );
  const rng = createRng(input.seed);

  const positionCounts = teams.map(() => new Array(n).fill(0) as number[]);
  const pointsSeen = teams.map(() => new Map<number, number>());
  const pointsSum = new Array(n).fill(0) as number[];
  const positionSum = new Array(n).fill(0) as number[];
  // outcomeTitle[f][o][t]: simulations where fixture f ended with outcome o and team t won.
  const outcomeTitle = fixtures.map(() => [0, 1, 2].map(() => new Array(n).fill(0) as number[]));
  const outcomeTotals = fixtures.map(() => [0, 0, 0]);
  const outcomes = new Uint8Array(fixtures.length);

  const table: TableRow[] = base.map((row) => ({ ...row }));
  const lots = new Array(n).fill(0) as number[];
  for (let s = 0; s < simulations; s++) {
    for (let i = 0; i < n; i++) {
      const row = table[i] as TableRow;
      const origin = base[i] as TableRow;
      row.points = origin.points;
      row.goalsFor = origin.goalsFor;
      row.goalsAgainst = origin.goalsAgainst;
      row.played = origin.played;
      lots[i] = rng.next();
    }
    fixtures.forEach((fixture, f) => {
      const cell = sampleCell(fixture.cdf, rng.next());
      const homeGoals = Math.floor(cell / fixture.width);
      const awayGoals = cell % fixture.width;
      applyResult(table, fixture.home, fixture.away, homeGoals, awayGoals);
      outcomes[f] = homeGoals > awayGoals ? 0 : homeGoals === awayGoals ? 1 : 2;
    });
    const order = rankTable(table, lots);
    order.forEach((team, position) => {
      (positionCounts[team] as number[])[position] += 1;
      positionSum[team] = (positionSum[team] as number) + position + 1;
      const points = (table[team] as TableRow).points;
      pointsSum[team] = (pointsSum[team] as number) + points;
      const seen = pointsSeen[team] as Map<number, number>;
      seen.set(points, (seen.get(points) ?? 0) + 1);
    });
    const champion = order[0] as number;
    for (let f = 0; f < fixtures.length; f++) {
      const outcome = outcomes[f] as number;
      (outcomeTotals[f] as number[])[outcome] += 1;
      ((outcomeTitle[f] as number[][])[outcome] as number[])[champion] += 1;
    }
  }

  const currentOrder = rankTable(
    base,
    teams.map((_, i) => i),
  );
  const currentPosition = new Array(n).fill(0) as number[];
  currentOrder.forEach((team, position) => {
    currentPosition[team] = position + 1;
  });

  const pointsQuantile = (team: number, q: number) => {
    const entries = [...(pointsSeen[team] as Map<number, number>).entries()].sort(
      ([a], [b]) => a - b,
    );
    const target = q * simulations;
    let cumulative = 0;
    for (const [points, count] of entries) {
      cumulative += count;
      if (cumulative >= target) return points;
    }
    return entries[entries.length - 1]?.[0] ?? 0;
  };

  const projections: TeamProjection[] = teams.map((team, i) => {
    const counts = positionCounts[i] as number[];
    const share = (from: number, to: number) =>
      counts.slice(from, to).reduce((total, count) => total + count, 0) / simulations;
    return {
      team,
      played: (base[i] as TableRow).played,
      remaining: remainingByTeam[i] as number,
      currentPoints: (base[i] as TableRow).points,
      currentPosition: currentPosition[i] as number,
      expectedPoints: round((pointsSum[i] as number) / simulations, 2),
      pointsP10: pointsQuantile(i, 0.1),
      pointsP90: pointsQuantile(i, 0.9),
      expectedPosition: round((positionSum[i] as number) / simulations, 2),
      positionProbabilities: counts.map((count) => round(count / simulations, 4)),
      title: round(share(0, 1), 4),
      top: round(share(0, zones.top), 4),
      bottom: round(share(n - zones.bottom, n), 4),
    };
  });

  const contenders = projections
    .map((projection, i) => ({ i, title: projection.title }))
    .filter((entry) => entry.title >= 0.01);
  const decisive: DecisiveFixture[] = [];
  fixtures.forEach((fixture, f) => {
    const totals = outcomeTotals[f] as number[];
    let best: DecisiveFixture | null = null;
    for (const { i } of contenders) {
      const conditional = [0, 1, 2].map((o) =>
        (totals[o] as number) > 0
          ? (((outcomeTitle[f] as number[][])[o] as number[])[i] as number) / (totals[o] as number)
          : null,
      );
      const known = conditional.filter((value): value is number => value !== null);
      if (known.length < 2) continue;
      const swing = Math.max(...known) - Math.min(...known);
      if (!best || swing > best.swing) {
        best = {
          id: fixture.fixture.id,
          homeKey: fixture.fixture.homeKey,
          awayKey: fixture.fixture.awayKey,
          kickoffAt: fixture.fixture.kickoffAt,
          teamKey: (teams[i] as SimulationTeam).key,
          ifHomeWin: round(conditional[0] ?? 0, 4),
          ifDraw: round(conditional[1] ?? 0, 4),
          ifAwayWin: round(conditional[2] ?? 0, 4),
          swing: round(swing, 4),
        };
      }
    }
    if (best && best.swing >= MIN_SWING) decisive.push(best);
  });
  decisive.sort((a, b) => b.swing - a.swing || a.kickoffAt.localeCompare(b.kickoffAt));

  return {
    simulations,
    remainingFixtures: fixtures.length,
    zones,
    teams: projections.sort(
      (a, b) => a.expectedPosition - b.expectedPosition || a.team.name.localeCompare(b.team.name),
    ),
    decisive: decisive.slice(0, DECISIVE_LIMIT),
    seed: input.seed,
  };
}
