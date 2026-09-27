import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createdAt, id, probability, ratio, timestampTz, updatedAt } from "./columns";
import { matchStatus, riskLevel } from "./enums";
import { modelVersions } from "./models";

export const sports = pgTable(
  "sports",
  {
    id: id(),
    key: varchar("key", { length: 40 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("sports_key_unique").on(t.key)],
);

export const competitions = pgTable(
  "competitions",
  {
    id: id(),
    sportId: uuid("sport_id")
      .notNull()
      .references(() => sports.id, { onDelete: "restrict" }),
    key: varchar("key", { length: 60 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    region: varchar("region", { length: 80 }),
    season: varchar("season", { length: 20 }).notNull(),
    /** League-average goals per team per match (model baseline). */
    baselineGoals: ratio("baseline_goals").notNull(),
    /** Multiplicative home-advantage factor applied to the home side's expected goals. */
    homeAdvantage: ratio("home_advantage").notNull(),
    externalRef: varchar("external_ref", { length: 120 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("competitions_key_season_unique").on(t.key, t.season),
    check(
      "competitions_model_params_positive",
      sql`${t.baselineGoals} > 0 and ${t.homeAdvantage} > 0`,
    ),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: id(),
    sportId: uuid("sport_id")
      .notNull()
      .references(() => sports.id, { onDelete: "restrict" }),
    /** Primary domestic competition. */
    competitionId: uuid("competition_id").references(() => competitions.id, {
      onDelete: "set null",
    }),
    key: varchar("key", { length: 60 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    shortName: varchar("short_name", { length: 40 }).notNull(),
    code: varchar("code", { length: 4 }).notNull(),
    city: varchar("city", { length: 80 }),
    externalRef: varchar("external_ref", { length: 120 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("teams_key_unique").on(t.key),
    index("teams_competition_idx").on(t.competitionId),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: id(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    homeTeamId: uuid("home_team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    awayTeamId: uuid("away_team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    kickoffAt: timestampTz("kickoff_at").notNull(),
    status: matchStatus("status").notNull().default("scheduled"),
    matchday: integer("matchday"),
    venue: varchar("venue", { length: 160 }),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    /** Stable provider identifier (demo ids look like "prem-2026-md05-kin-ash"). */
    externalRef: varchar("external_ref", { length: 120 }).notNull(),
    /** Pre-match context: form, rest days, injuries, recent xG. */
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("matches_external_ref_unique").on(t.externalRef),
    index("matches_kickoff_idx").on(t.kickoffAt),
    index("matches_competition_kickoff_idx").on(t.competitionId, t.kickoffAt),
    index("matches_home_team_idx").on(t.homeTeamId),
    index("matches_away_team_idx").on(t.awayTeamId),
    check("matches_distinct_teams", sql`${t.homeTeamId} <> ${t.awayTeamId}`),
    check(
      "matches_scores_non_negative",
      sql`coalesce(${t.homeScore}, 0) >= 0 and coalesce(${t.awayScore}, 0) >= 0`,
    ),
    check(
      "matches_finished_has_score",
      sql`${t.status} <> 'finished' or (${t.homeScore} is not null and ${t.awayScore} is not null)`,
    ),
  ],
);

export const matchPredictions = pgTable(
  "match_predictions",
  {
    id: id(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    modelVersionId: uuid("model_version_id").references(() => modelVersions.id, {
      onDelete: "set null",
    }),
    generatedAt: timestampTz("generated_at").notNull(),
    lambdaHome: ratio("lambda_home").notNull(),
    lambdaAway: ratio("lambda_away").notNull(),
    pHome: probability("p_home").notNull(),
    pDraw: probability("p_draw").notNull(),
    pAway: probability("p_away").notNull(),
    pOver15: probability("p_over_15").notNull(),
    pOver25: probability("p_over_25").notNull(),
    pOver35: probability("p_over_35").notNull(),
    pUnder25: probability("p_under_25").notNull(),
    pBtts: probability("p_btts").notNull(),
    pCleanSheetHome: probability("p_clean_sheet_home").notNull(),
    pCleanSheetAway: probability("p_clean_sheet_away").notNull(),
    confidence: probability("confidence").notNull(),
    uncertainty: riskLevel("uncertainty").notNull(),
    scoreMatrix: jsonb("score_matrix").$type<number[][]>().notNull(),
    topScorelines: jsonb("top_scorelines")
      .$type<{ home: number; away: number; probability: number }[]>()
      .notNull(),
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("match_predictions_match_generated_idx").on(t.matchId, t.generatedAt),
    check("match_predictions_lambdas_positive", sql`${t.lambdaHome} > 0 and ${t.lambdaAway} > 0`),
    check(
      "match_predictions_1x2_sums_to_one",
      sql`abs(${t.pHome} + ${t.pDraw} + ${t.pAway} - 1) < 0.001`,
    ),
    check(
      "match_predictions_over_under_complement",
      sql`abs(${t.pOver25} + ${t.pUnder25} - 1) < 0.001`,
    ),
  ],
);
