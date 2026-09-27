import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { assets, backtestResults, backtests } from "@/db/schema";
import type { BacktestResult } from "@/lib/backtesting/engine";
import { STRATEGIES } from "@/lib/backtesting/strategies";

/** Persist a completed backtest run (called only when DATABASE_URL is configured). */
export async function saveBacktestRun(
  result: BacktestResult,
  userId: string | null,
): Promise<string> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [asset] = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.symbol, result.config.symbol))
      .limit(1);
    const [row] = await tx
      .insert(backtests)
      .values({
        userId,
        assetId: asset?.id ?? null,
        symbol: result.config.symbol,
        strategy: result.config.strategy,
        parameters: STRATEGIES[result.config.strategy].parameters,
        startDate: result.config.startDate,
        endDate: result.config.endDate,
        initialCapital: result.config.initialCapital,
        feeBps: result.config.feeBps,
        slippageBps: result.config.slippageBps,
        status: "succeeded",
      })
      .returning({ id: backtests.id });
    if (!row) throw new Error("Failed to persist backtest");
    const m = result.metrics;
    await tx.insert(backtestResults).values({
      backtestId: row.id,
      endingCapital: m.endingCapital,
      totalReturn: m.totalReturn,
      benchmarkReturn: m.benchmarkReturn,
      tradesCount: m.trades,
      winRate: m.winRate,
      maxDrawdown: m.maxDrawdown,
      volatility: m.volatility,
      sharpe: m.sharpe,
      exposure: m.exposure,
      equityCurve: result.equityCurve.map(({ date, equity, benchmark }) => ({
        date,
        equity,
        benchmark,
      })),
      trades: result.trades.map((trade) => ({ ...trade })),
    });
    return row.id;
  });
}

export interface StoredBacktestSummary {
  id: string;
  symbol: string;
  strategy: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  totalReturn: number | null;
  benchmarkReturn: number | null;
}

export async function listRecentBacktests(limit = 10): Promise<StoredBacktestSummary[]> {
  const rows = await getDb()
    .select({
      id: backtests.id,
      symbol: backtests.symbol,
      strategy: backtests.strategy,
      startDate: backtests.startDate,
      endDate: backtests.endDate,
      createdAt: backtests.createdAt,
      totalReturn: backtestResults.totalReturn,
      benchmarkReturn: backtestResults.benchmarkReturn,
    })
    .from(backtests)
    .leftJoin(backtestResults, eq(backtestResults.backtestId, backtests.id))
    .orderBy(desc(backtests.createdAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
