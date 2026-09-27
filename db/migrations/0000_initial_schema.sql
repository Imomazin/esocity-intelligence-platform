CREATE TYPE "public"."asset_class" AS ENUM('equity', 'etf', 'index', 'crypto', 'fx', 'commodity');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'demo', 'system', 'service');--> statement-breakpoint
CREATE TYPE "public"."audit_outcome" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TYPE "public"."backtest_strategy" AS ENUM('sma_crossover', 'momentum', 'composite');--> statement-breakpoint
CREATE TYPE "public"."market_regime" AS ENUM('UPTREND', 'DOWNTREND', 'RANGE_BOUND', 'HIGH_VOLATILITY');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('scheduled', 'live', 'finished', 'postponed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."model_domain" AS ENUM('markets', 'sports');--> statement-breakpoint
CREATE TYPE "public"."model_run_type" AS ENUM('training', 'evaluation', 'inference', 'backtest');--> statement-breakpoint
CREATE TYPE "public"."model_status" AS ENUM('development', 'staging', 'production', 'retired');--> statement-breakpoint
CREATE TYPE "public"."notification_severity" AS ENUM('info', 'success', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('signal', 'match', 'trade', 'risk', 'model', 'system');--> statement-breakpoint
CREATE TYPE "public"."order_side" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING', 'FILLED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('MARKET', 'LIMIT');--> statement-breakpoint
CREATE TYPE "public"."paper_account_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."price_interval" AS ENUM('1m', '5m', '1h', '1d');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('LOW', 'MODERATE', 'HIGH', 'VERY_HIGH');--> statement-breakpoint
CREATE TYPE "public"."risk_profile" AS ENUM('conservative', 'balanced', 'aggressive');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."theme_preference" AS ENUM('system', 'light', 'dark');--> statement-breakpoint
CREATE TYPE "public"."trade_signal" AS ENUM('BUY', 'HOLD', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('DEPOSIT', 'WITHDRAWAL', 'BUY', 'SELL', 'FEE', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('viewer', 'analyst', 'admin');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(16) NOT NULL,
	"name" varchar(160) NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"exchange" varchar(32),
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"sector" varchar(80),
	"industry" varchar(120),
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_symbol_uppercase" CHECK ("assets"."symbol" = upper("assets"."symbol"))
);
--> statement-breakpoint
CREATE TABLE "market_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"interval" "price_interval" DEFAULT '1d' NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"open" numeric(18, 6) NOT NULL,
	"high" numeric(18, 6) NOT NULL,
	"low" numeric(18, 6) NOT NULL,
	"close" numeric(18, 6) NOT NULL,
	"volume" bigint NOT NULL,
	"source" varchar(40) DEFAULT 'demo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_prices_positive" CHECK ("market_prices"."low" > 0 and "market_prices"."volume" >= 0),
	CONSTRAINT "market_prices_ohlc_consistent" CHECK ("market_prices"."high" >= greatest("market_prices"."open", "market_prices"."close", "market_prices"."low") and "market_prices"."low" <= least("market_prices"."open", "market_prices"."close"))
);
--> statement-breakpoint
CREATE TABLE "market_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"model_version_id" uuid,
	"as_of" timestamp with time zone NOT NULL,
	"horizon_days" integer DEFAULT 20 NOT NULL,
	"signal" "trade_signal" NOT NULL,
	"score" numeric(14, 6) NOT NULL,
	"confidence" numeric(8, 6) NOT NULL,
	"probability_up" numeric(8, 6) NOT NULL,
	"regime" "market_regime" NOT NULL,
	"risk_score" integer NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"explanation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_signals_score_range" CHECK ("market_signals"."score" between -1 and 1),
	CONSTRAINT "market_signals_probability_range" CHECK ("market_signals"."confidence" between 0 and 1 and "market_signals"."probability_up" between 0 and 1),
	CONSTRAINT "market_signals_risk_range" CHECK ("market_signals"."risk_score" between 0 and 100),
	CONSTRAINT "market_signals_horizon_positive" CHECK ("market_signals"."horizon_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_version_id" uuid NOT NULL,
	"run_type" "model_run_type" NOT NULL,
	"status" "run_status" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_runs_finish_after_start" CHECK ("model_runs"."finished_at" is null or "model_runs"."finished_at" >= "model_runs"."started_at")
);
--> statement-breakpoint
CREATE TABLE "model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_key" varchar(80) NOT NULL,
	"version" varchar(32) NOT NULL,
	"domain" "model_domain" NOT NULL,
	"name" varchar(120) NOT NULL,
	"status" "model_status" DEFAULT 'development' NOT NULL,
	"description" text NOT NULL,
	"training_data" text NOT NULL,
	"feature_groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"released_at" timestamp with time zone,
	"last_evaluated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport_id" uuid NOT NULL,
	"key" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"region" varchar(80),
	"season" varchar(20) NOT NULL,
	"baseline_goals" numeric(14, 6) NOT NULL,
	"home_advantage" numeric(14, 6) NOT NULL,
	"external_ref" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitions_model_params_positive" CHECK ("competitions"."baseline_goals" > 0 and "competitions"."home_advantage" > 0)
);
--> statement-breakpoint
CREATE TABLE "match_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"model_version_id" uuid,
	"generated_at" timestamp with time zone NOT NULL,
	"lambda_home" numeric(14, 6) NOT NULL,
	"lambda_away" numeric(14, 6) NOT NULL,
	"p_home" numeric(8, 6) NOT NULL,
	"p_draw" numeric(8, 6) NOT NULL,
	"p_away" numeric(8, 6) NOT NULL,
	"p_over_15" numeric(8, 6) NOT NULL,
	"p_over_25" numeric(8, 6) NOT NULL,
	"p_over_35" numeric(8, 6) NOT NULL,
	"p_under_25" numeric(8, 6) NOT NULL,
	"p_btts" numeric(8, 6) NOT NULL,
	"p_clean_sheet_home" numeric(8, 6) NOT NULL,
	"p_clean_sheet_away" numeric(8, 6) NOT NULL,
	"confidence" numeric(8, 6) NOT NULL,
	"uncertainty" "risk_level" NOT NULL,
	"score_matrix" jsonb NOT NULL,
	"top_scorelines" jsonb NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_predictions_lambdas_positive" CHECK ("match_predictions"."lambda_home" > 0 and "match_predictions"."lambda_away" > 0),
	CONSTRAINT "match_predictions_1x2_sums_to_one" CHECK (abs("match_predictions"."p_home" + "match_predictions"."p_draw" + "match_predictions"."p_away" - 1) < 0.001),
	CONSTRAINT "match_predictions_over_under_complement" CHECK (abs("match_predictions"."p_over_25" + "match_predictions"."p_under_25" - 1) < 0.001)
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"kickoff_at" timestamp with time zone NOT NULL,
	"status" "match_status" DEFAULT 'scheduled' NOT NULL,
	"matchday" integer,
	"venue" varchar(160),
	"home_score" integer,
	"away_score" integer,
	"external_ref" varchar(120) NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_distinct_teams" CHECK ("matches"."home_team_id" <> "matches"."away_team_id"),
	CONSTRAINT "matches_scores_non_negative" CHECK (coalesce("matches"."home_score", 0) >= 0 and coalesce("matches"."away_score", 0) >= 0),
	CONSTRAINT "matches_finished_has_score" CHECK ("matches"."status" <> 'finished' or ("matches"."home_score" is not null and "matches"."away_score" is not null))
);
--> statement-breakpoint
CREATE TABLE "sports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(40) NOT NULL,
	"name" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport_id" uuid NOT NULL,
	"competition_id" uuid,
	"key" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"short_name" varchar(40) NOT NULL,
	"code" varchar(4) NOT NULL,
	"city" varchar(80),
	"external_ref" varchar(120),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" varchar(64),
	"action" varchar(80) NOT NULL,
	"resource_type" varchar(60),
	"resource_id" varchar(120),
	"outcome" "audit_outcome" NOT NULL,
	"request_id" varchar(64),
	"ip_address" varchar(64),
	"user_agent" varchar(400),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"severity" "notification_severity" DEFAULT 'info' NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"link" varchar(500),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backtest_id" uuid NOT NULL,
	"ending_capital" numeric(20, 6) NOT NULL,
	"total_return" numeric(14, 6) NOT NULL,
	"benchmark_return" numeric(14, 6) NOT NULL,
	"trades_count" integer NOT NULL,
	"win_rate" numeric(14, 6),
	"max_drawdown" numeric(14, 6) NOT NULL,
	"volatility" numeric(14, 6) NOT NULL,
	"sharpe" numeric(14, 6) NOT NULL,
	"exposure" numeric(14, 6) NOT NULL,
	"equity_curve" jsonb NOT NULL,
	"trades" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backtest_results_trades_non_negative" CHECK ("backtest_results"."trades_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "backtests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"asset_id" uuid,
	"symbol" varchar(16) NOT NULL,
	"strategy" "backtest_strategy" NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"initial_capital" numeric(20, 6) NOT NULL,
	"fee_bps" numeric(14, 6) NOT NULL,
	"slippage_bps" numeric(14, 6) NOT NULL,
	"status" "run_status" DEFAULT 'succeeded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backtests_date_order" CHECK ("backtests"."end_date" > "backtests"."start_date"),
	CONSTRAINT "backtests_capital_positive" CHECK ("backtests"."initial_capital" > 0),
	CONSTRAINT "backtests_costs_non_negative" CHECK ("backtests"."fee_bps" >= 0 and "backtests"."slippage_bps" >= 0)
);
--> statement-breakpoint
CREATE TABLE "paper_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(80) DEFAULT 'Paper portfolio' NOT NULL,
	"base_currency" char(3) DEFAULT 'USD' NOT NULL,
	"starting_cash" numeric(20, 6) NOT NULL,
	"cash" numeric(20, 6) NOT NULL,
	"status" "paper_account_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paper_accounts_cash_non_negative" CHECK ("paper_accounts"."cash" >= 0),
	CONSTRAINT "paper_accounts_starting_cash_positive" CHECK ("paper_accounts"."starting_cash" > 0)
);
--> statement-breakpoint
CREATE TABLE "paper_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"asset_id" uuid,
	"symbol" varchar(16) NOT NULL,
	"side" "order_side" NOT NULL,
	"order_type" "order_type" DEFAULT 'MARKET' NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"status" "order_status" NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"filled_at" timestamp with time zone,
	"reference_price" numeric(18, 6),
	"fill_price" numeric(18, 6),
	"fee" numeric(20, 6) DEFAULT 0 NOT NULL,
	"notional" numeric(20, 6),
	"slippage_bps" numeric(14, 6),
	"rejection_reason" varchar(64),
	"rejection_message" text,
	"client_order_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paper_orders_quantity_positive" CHECK ("paper_orders"."quantity" > 0),
	CONSTRAINT "paper_orders_filled_has_price" CHECK ("paper_orders"."status" <> 'FILLED' or ("paper_orders"."fill_price" is not null and "paper_orders"."filled_at" is not null)),
	CONSTRAINT "paper_orders_rejected_has_reason" CHECK ("paper_orders"."status" <> 'REJECTED' or "paper_orders"."rejection_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "paper_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"asset_id" uuid,
	"symbol" varchar(16) NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"average_cost" numeric(18, 6) NOT NULL,
	"realized_pnl" numeric(20, 6) DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paper_positions_quantity_non_negative" CHECK ("paper_positions"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "paper_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"order_id" uuid,
	"type" "transaction_type" NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"balance_after" numeric(20, 6) NOT NULL,
	"description" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paper_transactions_balance_non_negative" CHECK ("paper_transactions"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"cash" numeric(20, 6) NOT NULL,
	"market_value" numeric(20, 6) NOT NULL,
	"total_value" numeric(20, 6) NOT NULL,
	"invested_capital" numeric(20, 6) NOT NULL,
	"unrealized_pnl" numeric(20, 6) NOT NULL,
	"realized_pnl" numeric(20, 6) NOT NULL,
	"risk_level" "risk_level" NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"theme" "theme_preference" DEFAULT 'system' NOT NULL,
	"base_currency" char(3) DEFAULT 'USD' NOT NULL,
	"risk_profile" "risk_profile" DEFAULT 'balanced' NOT NULL,
	"default_market_symbol" varchar(16),
	"compact_numbers" boolean DEFAULT false NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"email_digest" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_currency_iso" CHECK ("user_preferences"."base_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320),
	"display_name" varchar(120) NOT NULL,
	"role" "user_role" DEFAULT 'analyst' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"auth_provider" varchar(40),
	"auth_subject" varchar(255),
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_identity_pair" CHECK (("users"."auth_provider" is null) = ("users"."auth_subject" is null))
);
--> statement-breakpoint
ALTER TABLE "market_prices" ADD CONSTRAINT "market_prices_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_signals" ADD CONSTRAINT "market_signals_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_signals" ADD CONSTRAINT "market_signals_model_version_id_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_model_version_id_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_predictions" ADD CONSTRAINT "match_predictions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_predictions" ADD CONSTRAINT "match_predictions_model_version_id_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_results" ADD CONSTRAINT "backtest_results_backtest_id_backtests_id_fk" FOREIGN KEY ("backtest_id") REFERENCES "public"."backtests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtests" ADD CONSTRAINT "backtests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtests" ADD CONSTRAINT "backtests_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD CONSTRAINT "paper_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_account_id_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."paper_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_account_id_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."paper_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_transactions" ADD CONSTRAINT "paper_transactions_account_id_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."paper_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_transactions" ADD CONSTRAINT "paper_transactions_order_id_paper_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."paper_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_account_id_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."paper_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_symbol_unique" ON "assets" USING btree ("symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "market_prices_asset_interval_ts_unique" ON "market_prices" USING btree ("asset_id","interval","ts");--> statement-breakpoint
CREATE INDEX "market_prices_ts_idx" ON "market_prices" USING btree ("ts");--> statement-breakpoint
CREATE UNIQUE INDEX "market_signals_asset_asof_horizon_unique" ON "market_signals" USING btree ("asset_id","as_of","horizon_days");--> statement-breakpoint
CREATE INDEX "market_signals_asof_idx" ON "market_signals" USING btree ("as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_items_unique" ON "watchlist_items" USING btree ("watchlist_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlists_user_name_unique" ON "watchlists" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "model_runs_version_started_idx" ON "model_runs" USING btree ("model_version_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "model_versions_key_version_unique" ON "model_versions" USING btree ("model_key","version");--> statement-breakpoint
CREATE INDEX "model_versions_domain_status_idx" ON "model_versions" USING btree ("domain","status");--> statement-breakpoint
CREATE UNIQUE INDEX "competitions_key_season_unique" ON "competitions" USING btree ("key","season");--> statement-breakpoint
CREATE INDEX "match_predictions_match_generated_idx" ON "match_predictions" USING btree ("match_id","generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_external_ref_unique" ON "matches" USING btree ("external_ref");--> statement-breakpoint
CREATE INDEX "matches_kickoff_idx" ON "matches" USING btree ("kickoff_at");--> statement-breakpoint
CREATE INDEX "matches_competition_kickoff_idx" ON "matches" USING btree ("competition_id","kickoff_at");--> statement-breakpoint
CREATE INDEX "matches_home_team_idx" ON "matches" USING btree ("home_team_id");--> statement-breakpoint
CREATE INDEX "matches_away_team_idx" ON "matches" USING btree ("away_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_key_unique" ON "sports" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_key_unique" ON "teams" USING btree ("key");--> statement-breakpoint
CREATE INDEX "teams_competition_idx" ON "teams" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "audit_events_occurred_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_resource_idx" ON "audit_events" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "backtest_results_backtest_unique" ON "backtest_results" USING btree ("backtest_id");--> statement-breakpoint
CREATE INDEX "backtests_user_created_idx" ON "backtests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "paper_accounts_user_idx" ON "paper_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "paper_orders_account_requested_idx" ON "paper_orders" USING btree ("account_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_orders_client_order_unique" ON "paper_orders" USING btree ("account_id","client_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_positions_account_symbol_unique" ON "paper_positions" USING btree ("account_id","symbol");--> statement-breakpoint
CREATE INDEX "paper_transactions_account_occurred_idx" ON "paper_transactions" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_snapshots_account_asof_unique" ON "portfolio_snapshots" USING btree ("account_id","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "user_preferences_user_unique" ON "user_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_identity_unique" ON "users" USING btree ("auth_provider","auth_subject");--> statement-breakpoint
CREATE INDEX "users_is_demo_idx" ON "users" USING btree ("is_demo");