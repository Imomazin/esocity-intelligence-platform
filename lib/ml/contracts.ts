import { z } from "zod";

/**
 * Wire contracts for the Python ML service (services/ml-api). The service speaks snake_case
 * JSON; these schemas validate every response before it reaches the app, so a misbehaving or
 * incompatible service degrades to the local engine instead of corrupting the UI.
 */

const probability = z.number().min(0).max(1);
const riskLevel = z.enum(["LOW", "MODERATE", "HIGH", "VERY_HIGH"]);

export const mlHealthSchema = z.object({
  status: z.string(),
  service: z.string(),
  version: z.string(),
  xgboost_available: z.boolean().optional(),
});

export const mlSportsResponseSchema = z.object({
  model_version: z.string(),
  lambda_home: z.number().positive(),
  lambda_away: z.number().positive(),
  max_goals: z.number().int().positive(),
  rho: z.number(),
  score_matrix: z.array(z.array(probability)),
  truncated_mass: z.number().min(0),
  outcome: z.object({ home: probability, draw: probability, away: probability }),
  most_likely_outcome: z.enum(["HOME", "DRAW", "AWAY"]),
  markets: z.object({
    over_15: probability,
    over_25: probability,
    over_35: probability,
    under_15: probability,
    under_25: probability,
    under_35: probability,
    btts_yes: probability,
    btts_no: probability,
    clean_sheet_home: probability,
    clean_sheet_away: probability,
  }),
  top_scorelines: z.array(
    z.object({ home: z.number().int(), away: z.number().int(), probability }),
  ),
  outcome_entropy: z.number(),
  data_quality: z.number(),
  confidence: z.number(),
  uncertainty: riskLevel,
  factors: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      home: z.number(),
      away: z.number(),
      description: z.string(),
    }),
  ),
});
export type MlSportsResponse = z.infer<typeof mlSportsResponseSchema>;

export const mlMarketResponseSchema = z.object({
  symbol: z.string(),
  as_of: z.string(),
  horizon_days: z.number().int(),
  model_version: z.string(),
  composite: z.object({
    signal: z.enum(["BUY", "HOLD", "SELL"]),
    score: z.number(),
    confidence: z.number(),
    regime: z.enum(["UPTREND", "DOWNTREND", "RANGE_BOUND", "HIGH_VOLATILITY"]),
  }),
  ml: z
    .object({
      model: z.string(),
      engine: z.string(),
      probability_up: probability,
      cv_auc: z.number().nullable(),
      cv_auc_std: z.number().nullable().optional(),
      training_samples: z.number().int(),
      top_features: z.array(z.object({ name: z.string(), importance: z.number() })),
    })
    .nullable(),
});
export type MlMarketResponse = z.infer<typeof mlMarketResponseSchema>;

export const mlBacktestResponseSchema = z.object({
  strategy_name: z.string(),
  metrics: z.object({
    starting_capital: z.number(),
    ending_capital: z.number(),
    total_return: z.number(),
    benchmark_return: z.number(),
    excess_return: z.number(),
    cagr: z.number(),
    trades: z.number().int(),
    win_rate: z.number().nullable(),
    average_trade_return: z.number().nullable(),
    max_drawdown: z.number(),
    benchmark_max_drawdown: z.number(),
    volatility: z.number(),
    sharpe: z.number(),
    benchmark_sharpe: z.number(),
    exposure: z.number(),
    fees_paid: z.number(),
    trading_days: z.number().int(),
  }),
  equity_curve: z.array(
    z.object({
      date: z.string(),
      equity: z.number(),
      benchmark: z.number(),
      drawdown: z.number(),
      exposure: z.union([z.literal(0), z.literal(1)]),
    }),
  ),
  trades: z.array(
    z.object({
      signal_date: z.string(),
      entry_date: z.string(),
      entry_price: z.number(),
      exit_signal_date: z.string().nullable(),
      exit_date: z.string().nullable(),
      exit_price: z.number().nullable(),
      shares: z.number().int(),
      pnl: z.number(),
      return_pct: z.number(),
      holding_days: z.number().int(),
      open: z.boolean(),
    }),
  ),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type MlBacktestResponse = z.infer<typeof mlBacktestResponseSchema>;
