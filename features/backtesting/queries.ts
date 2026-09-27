import "server-only";

import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit";
import { addDays } from "@/lib/clock";
import {
  BacktestInputError,
  DEFAULT_BACKTEST_COSTS,
  type BacktestResult,
} from "@/lib/backtesting/engine";
import { STRATEGIES, STRATEGY_IDS, type StrategyId } from "@/lib/backtesting/strategies";
import { getMarketDataProvider } from "@/lib/markets/providers";
import { getIntelligenceEngine, type EngineInfo } from "@/lib/ml/engine";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Shared by the /backtesting page (query string) and POST /api/backtests (JSON body). */
export const backtestParamsSchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z.]{0,9}$/, "Invalid symbol")
    .default("NVDA"),
  strategy: z.enum(STRATEGY_IDS as [StrategyId, ...StrategyId[]]).default("composite"),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  initialCapital: z.coerce
    .number()
    .min(1_000)
    .max(10_000_000)
    .default(DEFAULT_BACKTEST_COSTS.initialCapital),
  feeBps: z.coerce.number().min(0).max(100).default(DEFAULT_BACKTEST_COSTS.feeBps),
  slippageBps: z.coerce.number().min(0).max(100).default(DEFAULT_BACKTEST_COSTS.slippageBps),
});

export type BacktestParams = z.output<typeof backtestParamsSchema>;

export interface BacktestPageData {
  params: Required<Omit<BacktestParams, "startDate" | "endDate">> & {
    startDate: string;
    endDate: string;
  };
  symbols: { symbol: string; name: string }[];
  strategies: { id: StrategyId; name: string; description: string; rules: string[] }[];
  range: { min: string; max: string };
  result: BacktestResult | null;
  engine: EngineInfo | null;
  error: string | null;
}

export async function runBacktestForParams(
  raw: BacktestParams,
  options: { audit?: { actorId: string | null; requestId?: string } } = {},
): Promise<BacktestPageData> {
  const provider = getMarketDataProvider();
  const session = provider.getSession();
  const assets = await provider.listAssets();
  const symbols = assets.map((asset) => ({ symbol: asset.symbol, name: asset.name }));
  const strategies = STRATEGY_IDS.map((id) => ({
    id,
    name: STRATEGIES[id].name,
    description: STRATEGIES[id].description,
    rules: STRATEGIES[id].rules,
  }));

  const maxDate = session.lastCompletedDate;
  const firstBar = (
    await provider.getDailyBars(symbols[0]?.symbol ?? "SPY", { limit: 100_000 })
  )[0];
  // Keep ~120 bars of warm-up available before the earliest selectable start date.
  const minDate = firstBar ? addDays(firstBar.date, 180) : "2022-07-01";
  const endDate = raw.endDate && raw.endDate <= maxDate ? raw.endDate : maxDate;
  const defaultStart = addDays(endDate, -730);
  const startDate = raw.startDate ?? (defaultStart < minDate ? minDate : defaultStart);
  const params = { ...raw, startDate, endDate };

  const base: Omit<BacktestPageData, "result" | "engine" | "error"> = {
    params,
    symbols,
    strategies,
    range: { min: minDate, max: maxDate },
  };

  if (!symbols.some((entry) => entry.symbol === params.symbol)) {
    return { ...base, result: null, engine: null, error: `Unknown symbol "${params.symbol}".` };
  }
  if (params.startDate < minDate) {
    return {
      ...base,
      result: null,
      engine: null,
      error: `Start date must be on or after ${minDate}.`,
    };
  }

  try {
    const bars = await provider.getDailyBars(params.symbol);
    const { result, engine } = await getIntelligenceEngine().runBacktest(bars, {
      symbol: params.symbol,
      strategy: params.strategy,
      startDate: params.startDate,
      endDate: params.endDate,
      initialCapital: params.initialCapital,
      feeBps: params.feeBps,
      slippageBps: params.slippageBps,
    });
    if (options.audit) {
      await recordAuditEvent({
        action: "backtest.run",
        actorType: "demo",
        actorId: options.audit.actorId,
        resourceType: "backtest",
        resourceId: `${params.symbol}:${params.strategy}`,
        outcome: "success",
        requestId: options.audit.requestId,
        metadata: { ...params, engine: engine.source },
      });
    }
    return { ...base, result, engine, error: null };
  } catch (error) {
    if (error instanceof BacktestInputError) {
      return { ...base, result: null, engine: null, error: error.message };
    }
    throw error;
  }
}
