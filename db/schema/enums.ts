import { pgEnum } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["viewer", "analyst", "admin"]);
export const themePreference = pgEnum("theme_preference", ["system", "light", "dark"]);
export const riskProfile = pgEnum("risk_profile", ["conservative", "balanced", "aggressive"]);

export const assetClass = pgEnum("asset_class", [
  "equity",
  "etf",
  "index",
  "crypto",
  "fx",
  "commodity",
]);
export const priceInterval = pgEnum("price_interval", ["1m", "5m", "1h", "1d"]);
export const tradeSignal = pgEnum("trade_signal", ["BUY", "HOLD", "SELL"]);
export const marketRegime = pgEnum("market_regime", [
  "UPTREND",
  "DOWNTREND",
  "RANGE_BOUND",
  "HIGH_VOLATILITY",
]);

export const matchStatus = pgEnum("match_status", [
  "scheduled",
  "live",
  "finished",
  "postponed",
  "cancelled",
]);
/** Shared four-level scale for portfolio risk and prediction uncertainty. */
export const riskLevel = pgEnum("risk_level", ["LOW", "MODERATE", "HIGH", "VERY_HIGH"]);

export const paperAccountStatus = pgEnum("paper_account_status", ["active", "closed"]);
export const orderSide = pgEnum("order_side", ["BUY", "SELL"]);
export const orderType = pgEnum("order_type", ["MARKET", "LIMIT"]);
export const orderStatus = pgEnum("order_status", ["PENDING", "FILLED", "REJECTED", "CANCELLED"]);
export const transactionType = pgEnum("transaction_type", [
  "DEPOSIT",
  "WITHDRAWAL",
  "BUY",
  "SELL",
  "FEE",
  "ADJUSTMENT",
]);

export const modelDomain = pgEnum("model_domain", ["markets", "sports"]);
export const modelStatus = pgEnum("model_status", [
  "development",
  "staging",
  "production",
  "retired",
]);
export const modelRunType = pgEnum("model_run_type", [
  "training",
  "evaluation",
  "inference",
  "backtest",
]);
export const runStatus = pgEnum("run_status", ["queued", "running", "succeeded", "failed"]);
export const backtestStrategy = pgEnum("backtest_strategy", [
  "sma_crossover",
  "momentum",
  "composite",
]);

export const notificationType = pgEnum("notification_type", [
  "signal",
  "match",
  "trade",
  "risk",
  "model",
  "system",
]);
export const notificationSeverity = pgEnum("notification_severity", [
  "info",
  "success",
  "warning",
  "critical",
]);

export const auditActorType = pgEnum("audit_actor_type", ["user", "demo", "system", "service"]);
export const auditOutcome = pgEnum("audit_outcome", ["success", "failure"]);

export const dataDomain = pgEnum("data_domain", ["markets", "sports"]);
export const ingestionStatus = pgEnum("ingestion_status", [
  "running",
  "succeeded",
  "partial",
  "failed",
  "abandoned",
]);
export const ingestionTrigger = pgEnum("ingestion_trigger", ["schedule", "manual"]);
