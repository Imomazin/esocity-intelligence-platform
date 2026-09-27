import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createdAt, id, price, probability, ratio, timestampTz, updatedAt } from "./columns";
import { assetClass, marketRegime, priceInterval, tradeSignal } from "./enums";
import { modelVersions } from "./models";
import { users } from "./users";

export const assets = pgTable(
  "assets",
  {
    id: id(),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    assetClass: assetClass("asset_class").notNull(),
    exchange: varchar("exchange", { length: 32 }),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    sector: varchar("sector", { length: 80 }),
    industry: varchar("industry", { length: 120 }),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("assets_symbol_unique").on(t.symbol),
    check("assets_symbol_uppercase", sql`${t.symbol} = upper(${t.symbol})`),
  ],
);

/**
 * OHLCV bars. A natural TimescaleDB hypertable candidate (partition on `ts`) once real
 * intraday feeds arrive — see docs/DATA_MODEL.md.
 */
export const marketPrices = pgTable(
  "market_prices",
  {
    id: id(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    interval: priceInterval("interval").notNull().default("1d"),
    /** Bar start time (UTC). Daily bars use 00:00 UTC of the trading date. */
    ts: timestampTz("ts").notNull(),
    open: price("open").notNull(),
    high: price("high").notNull(),
    low: price("low").notNull(),
    close: price("close").notNull(),
    volume: bigint("volume", { mode: "number" }).notNull(),
    source: varchar("source", { length: 40 }).notNull().default("demo"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("market_prices_asset_interval_ts_unique").on(t.assetId, t.interval, t.ts),
    index("market_prices_ts_idx").on(t.ts),
    check("market_prices_positive", sql`${t.low} > 0 and ${t.volume} >= 0`),
    check(
      "market_prices_ohlc_consistent",
      sql`${t.high} >= greatest(${t.open}, ${t.close}, ${t.low}) and ${t.low} <= least(${t.open}, ${t.close})`,
    ),
  ],
);

export const marketSignals = pgTable(
  "market_signals",
  {
    id: id(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    modelVersionId: uuid("model_version_id").references(() => modelVersions.id, {
      onDelete: "set null",
    }),
    asOf: timestampTz("as_of").notNull(),
    horizonDays: integer("horizon_days").notNull().default(20),
    signal: tradeSignal("signal").notNull(),
    score: ratio("score").notNull(),
    confidence: probability("confidence").notNull(),
    probabilityUp: probability("probability_up").notNull(),
    regime: marketRegime("regime").notNull(),
    riskScore: integer("risk_score").notNull(),
    components: jsonb("components").$type<Record<string, unknown>[]>().notNull().default([]),
    explanation: text("explanation").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("market_signals_asset_asof_horizon_unique").on(t.assetId, t.asOf, t.horizonDays),
    index("market_signals_asof_idx").on(t.asOf),
    check("market_signals_score_range", sql`${t.score} between -1 and 1`),
    check(
      "market_signals_probability_range",
      sql`${t.confidence} between 0 and 1 and ${t.probabilityUp} between 0 and 1`,
    ),
    check("market_signals_risk_range", sql`${t.riskScore} between 0 and 100`),
    check("market_signals_horizon_positive", sql`${t.horizonDays} > 0`),
  ],
);

export const watchlists = pgTable(
  "watchlists",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("watchlists_user_name_unique").on(t.userId, t.name)],
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: id(),
    watchlistId: uuid("watchlist_id")
      .notNull()
      .references(() => watchlists.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("watchlist_items_unique").on(t.watchlistId, t.assetId)],
);
