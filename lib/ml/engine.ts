import type { z } from "zod";

import { runBacktest, type BacktestConfig, type BacktestResult } from "@/lib/backtesting/engine";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { PriceBar } from "@/lib/markets/types";
import {
  mlBacktestResponseSchema,
  mlHealthSchema,
  mlMarketResponseSchema,
  mlSportsResponseSchema,
  type MlBacktestResponse,
  type MlMarketResponse,
  type MlSportsResponse,
} from "@/lib/ml/contracts";
import { FOOTBALL_MODEL_VERSION, predictMatch } from "@/lib/sports/football-model";
import type { MatchModelInputs, MatchPrediction } from "@/lib/sports/types";

/**
 * Intelligence engine abstraction.
 *
 *   LocalIntelligenceEngine   — the TypeScript engines in lib/ (always available; default).
 *   RemoteIntelligenceEngine  — the Python ML service at ML_API_URL, with automatic fallback to
 *                                the local engine on timeout, network error, non-2xx or an
 *                                invalid response. The Next.js app never depends on the
 *                                Python service being online.
 */

export interface EngineInfo {
  source: "local" | "remote";
  name: string;
  /** Present when the remote engine was configured but the local engine answered. */
  fallbackReason?: string;
}

export interface MarketSupplement {
  model: string;
  engine: string;
  probabilityUp: number;
  cvAuc: number | null;
  cvAucStd: number | null;
  trainingSamples: number;
  topFeatures: { name: string; importance: number }[];
  remoteComposite: { signal: string; score: number; confidence: number; regime: string };
}

export interface EngineHealth {
  status: "up" | "down" | "not_configured";
  latencyMs?: number;
  version?: string;
  xgboostAvailable?: boolean;
  error?: string;
}

export interface IntelligenceEngine {
  readonly source: "local" | "remote";
  predictMatch(
    inputs: MatchModelInputs,
  ): Promise<{ prediction: MatchPrediction; engine: EngineInfo }>;
  runBacktest(
    bars: readonly PriceBar[],
    config: BacktestConfig,
  ): Promise<{ result: BacktestResult; engine: EngineInfo }>;
  marketSupplement(
    symbol: string,
    bars: readonly PriceBar[],
    horizonDays: number,
  ): Promise<{ supplement: MarketSupplement | null; engine: EngineInfo }>;
  health(): Promise<EngineHealth>;
}

const LOCAL_ENGINE_NAME = "Esocity TypeScript engines";

export class LocalIntelligenceEngine implements IntelligenceEngine {
  readonly source = "local" as const;

  async predictMatch(inputs: MatchModelInputs) {
    return {
      prediction: predictMatch(inputs),
      engine: { source: "local" as const, name: LOCAL_ENGINE_NAME },
    };
  }

  async runBacktest(bars: readonly PriceBar[], config: BacktestConfig) {
    return {
      result: runBacktest(bars, config),
      engine: { source: "local" as const, name: LOCAL_ENGINE_NAME },
    };
  }

  async marketSupplement() {
    // The ML supplement is only produced by the Python service.
    return { supplement: null, engine: { source: "local" as const, name: LOCAL_ENGINE_NAME } };
  }

  async health(): Promise<EngineHealth> {
    return { status: "not_configured" };
  }
}

class RemoteEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteEngineError";
  }
}

export class RemoteIntelligenceEngine implements IntelligenceEngine {
  readonly source = "remote" as const;
  private readonly local = new LocalIntelligenceEngine();

  constructor(
    private readonly baseUrl: string,
    private readonly options: { apiKey?: string; timeoutMs: number },
  ) {}

  private async call<S extends z.ZodType>(
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.output<S>> {
    const url = new URL(path, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    let response: Response;
    try {
      response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(this.options.apiKey ? { "x-api-key": this.options.apiKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      throw new RemoteEngineError(
        error instanceof Error && error.name === "TimeoutError"
          ? `timed out after ${this.options.timeoutMs}ms`
          : `unreachable (${error instanceof Error ? error.message : "network error"})`,
      );
    }
    if (!response.ok) throw new RemoteEngineError(`responded ${response.status}`);
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new RemoteEngineError("returned an invalid payload");
    return parsed.data;
  }

  private fallback(operation: string, error: unknown): EngineInfo {
    const reason = error instanceof Error ? error.message : "unknown error";
    logger.warn("ml_api.fallback", { operation, reason });
    return { source: "local", name: LOCAL_ENGINE_NAME, fallbackReason: `ML API ${reason}` };
  }

  async predictMatch(inputs: MatchModelInputs) {
    try {
      const data = await this.call(
        "predict/sports",
        mlSportsResponseSchema,
        toSportsRequest(inputs),
      );
      return {
        prediction: fromSportsResponse(data),
        engine: { source: "remote" as const, name: `Esocity ML API (model ${data.model_version})` },
      };
    } catch (error) {
      const { prediction } = await this.local.predictMatch(inputs);
      return { prediction, engine: this.fallback("predict/sports", error) };
    }
  }

  async runBacktest(bars: readonly PriceBar[], config: BacktestConfig) {
    try {
      const data = await this.call("backtest", mlBacktestResponseSchema, {
        symbol: config.symbol,
        strategy: config.strategy,
        start_date: config.startDate,
        end_date: config.endDate,
        initial_capital: config.initialCapital,
        fee_bps: config.feeBps,
        slippage_bps: config.slippageBps,
        bars,
      });
      return {
        result: fromBacktestResponse(data, config),
        engine: { source: "remote" as const, name: "Esocity ML API" },
      };
    } catch (error) {
      const { result } = await this.local.runBacktest(bars, config);
      return { result, engine: this.fallback("backtest", error) };
    }
  }

  async marketSupplement(symbol: string, bars: readonly PriceBar[], horizonDays: number) {
    try {
      const data = await this.call("predict/market", mlMarketResponseSchema, {
        symbol,
        horizon_days: horizonDays,
        bars: bars.slice(-750),
      });
      return {
        supplement: fromMarketResponse(data),
        engine: { source: "remote" as const, name: `Esocity ML API (model ${data.model_version})` },
      };
    } catch (error) {
      return { supplement: null, engine: this.fallback("predict/market", error) };
    }
  }

  async health(): Promise<EngineHealth> {
    const started = performance.now();
    try {
      const data = await this.call("health", mlHealthSchema);
      return {
        status: data.status === "ok" ? "up" : "down",
        latencyMs: Math.round(performance.now() - started),
        version: data.version,
        xgboostAvailable: data.xgboost_available,
      };
    } catch (error) {
      return {
        status: "down",
        latencyMs: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : "unknown error",
      };
    }
  }
}

// ─── Mapping helpers (snake_case wire ⇄ camelCase domain) ──────────────────────────────────

export function toSportsRequest(inputs: MatchModelInputs) {
  const side = (team: MatchModelInputs["home"]) => ({
    attack: team.attack,
    defence: team.defence,
    form: team.form ?? [],
    xg_for: team.xgFor ?? null,
    xg_against: team.xgAgainst ?? null,
    injuries: team.injuries ?? "none",
    rest_days: team.restDays ?? null,
  });
  return {
    home: side(inputs.home),
    away: side(inputs.away),
    league_baseline_goals: inputs.leagueBaselineGoals,
    home_advantage: inputs.homeAdvantage,
    rho: inputs.rho ?? null,
    max_goals: inputs.maxGoals ?? 6,
  };
}

function fromSportsResponse(data: MlSportsResponse): MatchPrediction {
  return {
    modelVersion: data.model_version || FOOTBALL_MODEL_VERSION,
    lambdaHome: data.lambda_home,
    lambdaAway: data.lambda_away,
    maxGoals: data.max_goals,
    rho: data.rho,
    scoreMatrix: data.score_matrix,
    truncatedMass: data.truncated_mass,
    outcome: data.outcome,
    mostLikelyOutcome: data.most_likely_outcome,
    markets: {
      over15: data.markets.over_15,
      over25: data.markets.over_25,
      over35: data.markets.over_35,
      under15: data.markets.under_15,
      under25: data.markets.under_25,
      under35: data.markets.under_35,
      bttsYes: data.markets.btts_yes,
      bttsNo: data.markets.btts_no,
      cleanSheetHome: data.markets.clean_sheet_home,
      cleanSheetAway: data.markets.clean_sheet_away,
    },
    topScorelines: data.top_scorelines,
    outcomeEntropy: data.outcome_entropy,
    dataQuality: data.data_quality,
    confidence: data.confidence,
    uncertainty: data.uncertainty,
    factors: data.factors,
  };
}

function fromMarketResponse(data: MlMarketResponse): MarketSupplement | null {
  if (!data.ml) return null;
  return {
    model: data.ml.model,
    engine: data.ml.engine,
    probabilityUp: data.ml.probability_up,
    cvAuc: data.ml.cv_auc,
    cvAucStd: data.ml.cv_auc_std ?? null,
    trainingSamples: data.ml.training_samples,
    topFeatures: data.ml.top_features,
    remoteComposite: data.composite,
  };
}

function fromBacktestResponse(data: MlBacktestResponse, config: BacktestConfig): BacktestResult {
  const m = data.metrics;
  return {
    config,
    strategyName: data.strategy_name,
    assumptions: data.assumptions,
    warnings: data.warnings,
    equityCurve: data.equity_curve,
    trades: data.trades.map((trade) => ({
      signalDate: trade.signal_date,
      entryDate: trade.entry_date,
      entryPrice: trade.entry_price,
      exitSignalDate: trade.exit_signal_date,
      exitDate: trade.exit_date,
      exitPrice: trade.exit_price,
      shares: trade.shares,
      pnl: trade.pnl,
      returnPct: trade.return_pct,
      holdingDays: trade.holding_days,
      open: trade.open,
    })),
    metrics: {
      startingCapital: m.starting_capital,
      endingCapital: m.ending_capital,
      totalReturn: m.total_return,
      benchmarkReturn: m.benchmark_return,
      excessReturn: m.excess_return,
      cagr: m.cagr,
      trades: m.trades,
      winRate: m.win_rate,
      averageTradeReturn: m.average_trade_return,
      maxDrawdown: m.max_drawdown,
      benchmarkMaxDrawdown: m.benchmark_max_drawdown,
      volatility: m.volatility,
      sharpe: m.sharpe,
      benchmarkSharpe: m.benchmark_sharpe,
      exposure: m.exposure,
      feesPaid: m.fees_paid,
      tradingDays: m.trading_days,
    },
  };
}

// ─── Factory ────────────────────────────────────────────────────────────────────────────────

let engine: IntelligenceEngine | null = null;

function isLocalhost(url: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Remote engine when ML_API_URL is configured (and not a localhost URL on Vercel); otherwise
 * the local engine.
 */
export function getIntelligenceEngine(): IntelligenceEngine {
  if (engine) return engine;
  const env = getServerEnv();
  if (env.ML_API_URL && !(process.env.VERCEL && isLocalhost(env.ML_API_URL))) {
    engine = new RemoteIntelligenceEngine(env.ML_API_URL, {
      apiKey: env.ML_API_KEY,
      timeoutMs: env.ML_API_TIMEOUT_MS,
    });
  } else {
    engine = new LocalIntelligenceEngine();
  }
  return engine;
}

/** Test helper. */
export function setIntelligenceEngineForTesting(next: IntelligenceEngine | null): void {
  engine = next;
}
