import { relations } from "drizzle-orm";

import { assets, marketPrices, marketSignals, watchlistItems, watchlists } from "./markets";
import { modelRuns, modelVersions } from "./models";
import { competitions, matchPredictions, matches, sports, teams } from "./sports";
import { auditEvents, notifications } from "./system";
import {
  backtestResults,
  backtests,
  paperAccounts,
  paperOrders,
  paperPositions,
  paperTransactions,
  portfolioSnapshots,
} from "./trading";
import { userPreferences, users } from "./users";

export * from "./enums";
export * from "./markets";
export * from "./models";
export * from "./sports";
export * from "./system";
export * from "./trading";
export * from "./users";

// ─── Relations (for Drizzle's relational query API) ──────────────────────────────────────────

export const usersRelations = relations(users, ({ one, many }) => ({
  preferences: one(userPreferences, {
    fields: [users.id],
    references: [userPreferences.userId],
  }),
  watchlists: many(watchlists),
  paperAccounts: many(paperAccounts),
  notifications: many(notifications),
}));

export const assetsRelations = relations(assets, ({ many }) => ({
  prices: many(marketPrices),
  signals: many(marketSignals),
}));

export const marketPricesRelations = relations(marketPrices, ({ one }) => ({
  asset: one(assets, { fields: [marketPrices.assetId], references: [assets.id] }),
}));

export const marketSignalsRelations = relations(marketSignals, ({ one }) => ({
  asset: one(assets, { fields: [marketSignals.assetId], references: [assets.id] }),
  modelVersion: one(modelVersions, {
    fields: [marketSignals.modelVersionId],
    references: [modelVersions.id],
  }),
}));

export const watchlistsRelations = relations(watchlists, ({ one, many }) => ({
  user: one(users, { fields: [watchlists.userId], references: [users.id] }),
  items: many(watchlistItems),
}));

export const watchlistItemsRelations = relations(watchlistItems, ({ one }) => ({
  watchlist: one(watchlists, { fields: [watchlistItems.watchlistId], references: [watchlists.id] }),
  asset: one(assets, { fields: [watchlistItems.assetId], references: [assets.id] }),
}));

export const competitionsRelations = relations(competitions, ({ one, many }) => ({
  sport: one(sports, { fields: [competitions.sportId], references: [sports.id] }),
  matches: many(matches),
  teams: many(teams),
}));

export const teamsRelations = relations(teams, ({ one }) => ({
  sport: one(sports, { fields: [teams.sportId], references: [sports.id] }),
  competition: one(competitions, {
    fields: [teams.competitionId],
    references: [competitions.id],
  }),
}));

export const matchesRelations = relations(matches, ({ one, many }) => ({
  competition: one(competitions, {
    fields: [matches.competitionId],
    references: [competitions.id],
  }),
  homeTeam: one(teams, { fields: [matches.homeTeamId], references: [teams.id] }),
  awayTeam: one(teams, { fields: [matches.awayTeamId], references: [teams.id] }),
  predictions: many(matchPredictions),
}));

export const matchPredictionsRelations = relations(matchPredictions, ({ one }) => ({
  match: one(matches, { fields: [matchPredictions.matchId], references: [matches.id] }),
}));

export const paperAccountsRelations = relations(paperAccounts, ({ one, many }) => ({
  user: one(users, { fields: [paperAccounts.userId], references: [users.id] }),
  orders: many(paperOrders),
  positions: many(paperPositions),
  transactions: many(paperTransactions),
  snapshots: many(portfolioSnapshots),
}));

export const paperOrdersRelations = relations(paperOrders, ({ one }) => ({
  account: one(paperAccounts, { fields: [paperOrders.accountId], references: [paperAccounts.id] }),
}));

export const paperPositionsRelations = relations(paperPositions, ({ one }) => ({
  account: one(paperAccounts, {
    fields: [paperPositions.accountId],
    references: [paperAccounts.id],
  }),
}));

export const paperTransactionsRelations = relations(paperTransactions, ({ one }) => ({
  account: one(paperAccounts, {
    fields: [paperTransactions.accountId],
    references: [paperAccounts.id],
  }),
}));

export const modelVersionsRelations = relations(modelVersions, ({ many }) => ({
  runs: many(modelRuns),
}));

export const modelRunsRelations = relations(modelRuns, ({ one }) => ({
  modelVersion: one(modelVersions, {
    fields: [modelRuns.modelVersionId],
    references: [modelVersions.id],
  }),
}));

export const backtestsRelations = relations(backtests, ({ one }) => ({
  result: one(backtestResults, {
    fields: [backtests.id],
    references: [backtestResults.backtestId],
  }),
}));

export const auditEventsRelations = relations(auditEvents, () => ({}));
