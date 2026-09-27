import { getNow, getUsMarketSession, type MarketSession } from "@/lib/clock";
import type { DailyBarsOptions, MarketDataProvider } from "@/lib/markets/providers/types";
import {
  generateSyntheticHistory,
  intradayPointAt,
  simulateIntradayPath,
} from "@/lib/markets/synthetic";
import type { AssetProfile, PriceBar, Quote } from "@/lib/markets/types";
import { DEMO_ASSETS, findDemoAsset } from "@/lib/markets/universe";

/**
 * Demo provider backed by the deterministic synthetic generator. Requires no API keys.
 *
 * Quotes are "live" in the sense that during US regular hours the price walks along a
 * deterministic intraday Brownian-bridge path that ends exactly at the day's synthetic close.
 */
export class DemoMarketDataProvider implements MarketDataProvider {
  readonly id = "demo";
  readonly displayName = "Esocity synthetic market (demo)";
  readonly isSimulated = true;

  constructor(private readonly clock: () => Date = getNow) {}

  getSession(): MarketSession {
    return getUsMarketSession(this.clock());
  }

  async listAssets(): Promise<AssetProfile[]> {
    return DEMO_ASSETS.map((asset) => ({ ...asset.profile }));
  }

  async getAsset(symbol: string): Promise<AssetProfile | null> {
    const asset = findDemoAsset(symbol);
    return asset ? { ...asset.profile } : null;
  }

  /** History through the current session date (includes today's bar while it is forming). */
  private history(symbol: string, session: MarketSession): readonly PriceBar[] {
    const through = session.isTradingDay ? session.sessionDate : session.lastCompletedDate;
    return generateSyntheticHistory(symbol, through);
  }

  async getDailyBars(symbol: string, options: DailyBarsOptions = {}): Promise<PriceBar[]> {
    const session = this.getSession();
    const asset = findDemoAsset(symbol);
    if (!asset) return [];
    let bars = this.history(asset.profile.symbol, session).filter(
      (bar) => bar.date <= session.lastCompletedDate,
    );
    if (options.from) bars = bars.filter((bar) => bar.date >= (options.from as string));
    if (options.to) bars = bars.filter((bar) => bar.date <= (options.to as string));
    if (options.limit !== undefined) bars = bars.slice(-options.limit);
    return bars.map((bar) => ({ ...bar }));
  }

  async getQuote(symbol: string): Promise<Quote> {
    const asset = findDemoAsset(symbol);
    if (!asset) throw new Error(`Unknown symbol: ${symbol}`);
    const now = this.clock();
    const session = this.getSession();
    const history = this.history(asset.profile.symbol, session);
    const completed = history.filter((bar) => bar.date <= session.lastCompletedDate);
    const lastCompleted = completed[completed.length - 1] as PriceBar;
    const priorCompleted = completed[completed.length - 2] ?? lastCompleted;

    if (session.status === "open") {
      const today = history[history.length - 1] as PriceBar;
      const path = simulateIntradayPath(asset.profile.symbol, today);
      const point = intradayPointAt(path, session.elapsedFraction);
      const previousClose = lastCompleted.close;
      return {
        symbol: asset.profile.symbol,
        price: point.price,
        previousClose,
        change: round2(point.price - previousClose),
        changePercent: point.price / previousClose - 1,
        dayOpen: today.open,
        dayHigh: point.high,
        dayLow: point.low,
        session: session.status,
        sessionDate: session.sessionDate,
        asOf: now.toISOString(),
        source: "simulated",
      };
    }

    // Pre-market, after the close or on a non-trading day: the last completed session.
    return {
      symbol: asset.profile.symbol,
      price: lastCompleted.close,
      previousClose: priorCompleted.close,
      change: round2(lastCompleted.close - priorCompleted.close),
      changePercent: lastCompleted.close / priorCompleted.close - 1,
      dayOpen: lastCompleted.open,
      dayHigh: lastCompleted.high,
      dayLow: lastCompleted.low,
      session: session.status,
      sessionDate: lastCompleted.date,
      asOf: now.toISOString(),
      source: "simulated",
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
