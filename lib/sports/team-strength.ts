import { round } from "@/lib/quant/stats";
import type { Match, Team } from "@/lib/sports/types";

/**
 * Team strength from the football model's own pre-match inputs.
 *
 * Every fixture carries the attack/defence ratings the model used before kick-off (estimated
 * from earlier results only), so a club's rating history is simply the sequence of those inputs
 * across its matches. The single-number "power" rating is the expected goal difference per match
 * against an average opponent at a neutral venue:
 *
 *   power = baseline × (attack − defence)
 *
 * (attack > 1 scores more than average; defence < 1 concedes less than average.)
 */

export interface StrengthPoint {
  round: number;
  kickoffAt: string;
  attack: number;
  defence: number;
  power: number;
}

export interface TeamStrength {
  team: Team;
  rank: number;
  attack: number;
  defence: number;
  power: number;
  /** Change in power over the last five rated matches (null with too little history). */
  trend: number | null;
  history: StrengthPoint[];
}

const TREND_WINDOW = 5;

export function powerRating(baseline: number, attack: number, defence: number): number {
  return baseline * (attack - defence);
}

/**
 * Ratings per club: history from finished (and live) fixtures, current value from the next
 * fixture's inputs when one exists (it already reflects every result so far).
 */
export function teamStrengths(teams: readonly Team[], matches: readonly Match[]): TeamStrength[] {
  const ordered = [...matches].sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
  const history = new Map<string, StrengthPoint[]>();
  const upcoming = new Map<string, StrengthPoint>();

  for (const match of ordered) {
    const { modelInputs } = match;
    const baseline = modelInputs.leagueBaselineGoals;
    for (const [team, inputs] of [
      [match.homeTeam, modelInputs.home],
      [match.awayTeam, modelInputs.away],
    ] as const) {
      const point: StrengthPoint = {
        round: match.round,
        kickoffAt: match.kickoffAt,
        attack: round(inputs.attack, 4),
        defence: round(inputs.defence, 4),
        power: round(powerRating(baseline, inputs.attack, inputs.defence), 4),
      };
      if (match.status === "scheduled" || match.status === "postponed") {
        if (!upcoming.has(team.key)) upcoming.set(team.key, point);
      } else if (match.status !== "cancelled") {
        history.set(team.key, [...(history.get(team.key) ?? []), point]);
      }
    }
  }

  const strengths = teams
    .map((team) => {
      const points = history.get(team.key) ?? [];
      const current = upcoming.get(team.key) ?? points[points.length - 1];
      if (!current) return null;
      const series = upcoming.has(team.key) ? [...points, current] : points;
      const reference = series[series.length - 1 - TREND_WINDOW];
      return {
        team,
        rank: 0,
        attack: current.attack,
        defence: current.defence,
        power: current.power,
        trend: reference ? round(current.power - reference.power, 4) : null,
        history: series,
      };
    })
    .filter((entry): entry is TeamStrength => entry !== null)
    .sort((a, b) => b.power - a.power || a.team.name.localeCompare(b.team.name));
  strengths.forEach((entry, i) => {
    entry.rank = i + 1;
  });
  return strengths;
}
