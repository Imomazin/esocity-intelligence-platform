import { sql } from "drizzle-orm";
import {
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createdAt, id, money, price, quantity, ratio, timestampTz, updatedAt } from "./columns";
import {
  backtestStrategy,
  orderSide,
  orderStatus,
  orderType,
  paperAccountStatus,
  riskLevel,
  runStatus,
  transactionType,
} from "./enums";
import { assets } from "./markets";
import { users } from "./users";

/**
 * PAPER TRADING ONLY. These tables model simulated accounts; there is intentionally no table
 * for broker credentials. Live execution requires a separate, compliance-reviewed design
 * (docs/PAPER_TRADING.md → "Path to live execution").
 */
export const paperAccounts = pgTable(
  "paper_accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull().default("Paper portfolio"),
    baseCurrency: char("base_currency", { length: 3 }).notNull().default("USD"),
    startingCash: money("starting_cash").notNull(),
    cash: money("cash").notNull(),
    status: paperAccountStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("paper_accounts_user_idx").on(t.userId),
    check("paper_accounts_cash_non_negative", sql`${t.cash} >= 0`),
    check("paper_accounts_starting_cash_positive", sql`${t.startingCash} > 0`),
  ],
);

export const paperOrders = pgTable(
  "paper_orders",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => paperAccounts.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    /** Denormalised for audit readability even if asset metadata changes. */
    symbol: varchar("symbol", { length: 16 }).notNull(),
    side: orderSide("side").notNull(),
    orderType: orderType("order_type").notNull().default("MARKET"),
    quantity: quantity("quantity").notNull(),
    status: orderStatus("status").notNull(),
    requestedAt: timestampTz("requested_at").notNull(),
    filledAt: timestampTz("filled_at"),
    /** Reference (mid) price at submission. */
    referencePrice: price("reference_price"),
    fillPrice: price("fill_price"),
    fee: money("fee").notNull().default(0),
    notional: money("notional"),
    slippageBps: ratio("slippage_bps"),
    rejectionReason: varchar("rejection_reason", { length: 64 }),
    rejectionMessage: text("rejection_message"),
    /** Client-supplied idempotency key. */
    clientOrderId: varchar("client_order_id", { length: 64 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("paper_orders_account_requested_idx").on(t.accountId, t.requestedAt),
    uniqueIndex("paper_orders_client_order_unique").on(t.accountId, t.clientOrderId),
    check("paper_orders_quantity_positive", sql`${t.quantity} > 0`),
    check(
      "paper_orders_filled_has_price",
      sql`${t.status} <> 'FILLED' or (${t.fillPrice} is not null and ${t.filledAt} is not null)`,
    ),
    check(
      "paper_orders_rejected_has_reason",
      sql`${t.status} <> 'REJECTED' or ${t.rejectionReason} is not null`,
    ),
  ],
);

export const paperPositions = pgTable(
  "paper_positions",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => paperAccounts.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    quantity: quantity("quantity").notNull(),
    averageCost: price("average_cost").notNull(),
    realizedPnl: money("realized_pnl").notNull().default(0),
    openedAt: timestampTz("opened_at").notNull(),
    closedAt: timestampTz("closed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("paper_positions_account_symbol_unique").on(t.accountId, t.symbol),
    check("paper_positions_quantity_non_negative", sql`${t.quantity} >= 0`),
  ],
);

export const paperTransactions = pgTable(
  "paper_transactions",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => paperAccounts.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => paperOrders.id, { onDelete: "set null" }),
    type: transactionType("type").notNull(),
    /** Signed cash impact in base currency. */
    amount: money("amount").notNull(),
    balanceAfter: money("balance_after").notNull(),
    description: text("description").notNull(),
    occurredAt: timestampTz("occurred_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("paper_transactions_account_occurred_idx").on(t.accountId, t.occurredAt),
    check("paper_transactions_balance_non_negative", sql`${t.balanceAfter} >= 0`),
  ],
);

export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => paperAccounts.id, { onDelete: "cascade" }),
    asOf: timestampTz("as_of").notNull(),
    cash: money("cash").notNull(),
    marketValue: money("market_value").notNull(),
    totalValue: money("total_value").notNull(),
    investedCapital: money("invested_capital").notNull(),
    unrealizedPnl: money("unrealized_pnl").notNull(),
    realizedPnl: money("realized_pnl").notNull(),
    riskLevel: riskLevel("risk_level").notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("portfolio_snapshots_account_asof_unique").on(t.accountId, t.asOf)],
);

export const backtests = pgTable(
  "backtests",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    strategy: backtestStrategy("strategy").notNull(),
    parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull().default({}),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    initialCapital: money("initial_capital").notNull(),
    feeBps: ratio("fee_bps").notNull(),
    slippageBps: ratio("slippage_bps").notNull(),
    status: runStatus("status").notNull().default("succeeded"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("backtests_user_created_idx").on(t.userId, t.createdAt),
    check("backtests_date_order", sql`${t.endDate} > ${t.startDate}`),
    check("backtests_capital_positive", sql`${t.initialCapital} > 0`),
    check("backtests_costs_non_negative", sql`${t.feeBps} >= 0 and ${t.slippageBps} >= 0`),
  ],
);

export const backtestResults = pgTable(
  "backtest_results",
  {
    id: id(),
    backtestId: uuid("backtest_id")
      .notNull()
      .references(() => backtests.id, { onDelete: "cascade" }),
    endingCapital: money("ending_capital").notNull(),
    totalReturn: ratio("total_return").notNull(),
    benchmarkReturn: ratio("benchmark_return").notNull(),
    tradesCount: integer("trades_count").notNull(),
    winRate: ratio("win_rate"),
    maxDrawdown: ratio("max_drawdown").notNull(),
    volatility: ratio("volatility").notNull(),
    sharpe: ratio("sharpe").notNull(),
    exposure: ratio("exposure").notNull(),
    equityCurve: jsonb("equity_curve")
      .$type<{ date: string; equity: number; benchmark: number }[]>()
      .notNull(),
    trades: jsonb("trades").$type<Record<string, unknown>[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("backtest_results_backtest_unique").on(t.backtestId),
    check("backtest_results_trades_non_negative", sql`${t.tradesCount} >= 0`),
  ],
);
