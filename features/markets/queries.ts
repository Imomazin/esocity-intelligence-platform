import "server-only";

import type {
  AssetDetail,
  AssetSummary,
  ChartPoint,
  MarketOverview,
  ProviderInfo,
  SessionInfo,
} from "@/features/markets/types";
import { analyzeUniverse, type AssetAnalysis, type UniverseAnalysis } from "@/lib/markets/analysis";
import { getMarketDataProvider, type MarketDataProvider } from "@/lib/markets/providers";
import type { Quote } from "@/lib/markets/types";
import { getIntelligenceEngine } from "@/lib/ml/engine";
import { round } from "@/lib/quant/stats";

const CHART_BARS = 504; // two years of daily bars
const SPARKLINE_BARS = 30;

interface UniverseCacheEntry {
  key: string;
  analysis: Promise<UniverseAnalysis>;
}

const globalForMarkets = globalThis as unknown as { __esocityUniverse?: UniverseCacheEntry };

function providerInfo(provider: MarketDataProvider): ProviderInfo {
  return { id: provider.id, displayName: provider.displayName, isSimulated: provider.isSimulated };
}

function sessionInfo(provider: MarketDataProvider): SessionInfo {
  const session = provider.getSession();
  return {
    status: session.status,
    sessionDate: session.sessionDate,
    lastCompletedDate: session.lastCompletedDate,
  };
}

/**
 * Universe analysis, memoised per provider + last completed trading day (the analysis only
 * changes when a new daily bar completes). Quotes are fetched fresh on every call.
 */
export async function getUniverseAnalysis(): Promise<UniverseAnalysis> {
  const provider = getMarketDataProvider();
  const key = `${provider.id}:${provider.getSession().lastCompletedDate}`;
  const cached = globalForMarkets.__esocityUniverse;
  if (cached?.key === key) return cached.analysis;

  const analysis = (async () => {
    const profiles = await provider.listAssets();
    const inputs = await Promise.all(
      profiles.map(async (profile) => ({
        profile,
        bars: await provider.getDailyBars(profile.symbol),
      })),
    );
    return analyzeUniverse(inputs);
  })();
  globalForMarkets.__esocityUniverse = { key, analysis };
  analysis.catch(() => {
    if (globalForMarkets.__esocityUniverse?.analysis === analysis) {
      globalForMarkets.__esocityUniverse = undefined;
    }
  });
  return analysis;
}

export async function getQuotes(): Promise<Map<string, Quote>> {
  const provider = getMarketDataProvider();
  const profiles = await provider.listAssets();
  const quotes = await Promise.all(profiles.map((profile) => provider.getQuote(profile.symbol)));
  return new Map(quotes.map((quote) => [quote.symbol, quote]));
}

function toSummary(asset: AssetAnalysis, quote: Quote | undefined): AssetSummary {
  const closes = asset.bars.slice(-SPARKLINE_BARS).map((bar) => bar.close);
  if (quote && quote.session === "open") closes.push(quote.price);
  return {
    symbol: asset.profile.symbol,
    name: asset.profile.name,
    sector: asset.profile.sector,
    assetClass: asset.profile.assetClass,
    price: quote?.price ?? asset.latest.close,
    change: quote?.change ?? 0,
    changePercent: quote?.changePercent ?? asset.performance.change1d ?? 0,
    sparkline: closes,
    signal: asset.signal.signal,
    score: asset.signal.score,
    confidence: asset.signal.confidence,
    probabilityUp: asset.signal.probabilityUp,
    regime: asset.signal.regime,
    riskScore: asset.risk.score,
    riskLevel: asset.risk.level,
    volatility20: asset.latest.volatility20,
    performance: asset.performance,
  };
}

export async function getMarketOverview(): Promise<MarketOverview> {
  const provider = getMarketDataProvider();
  const [analysis, quotes] = await Promise.all([getUniverseAnalysis(), getQuotes()]);
  const assets = analysis.assets.map((asset) => toSummary(asset, quotes.get(asset.profile.symbol)));
  const byChange = [...assets].sort((a, b) => b.changePercent - a.changePercent);
  const { reliability: _reliability, ...evaluation } = analysis.evaluation;
  return {
    asOf: analysis.asOf,
    session: sessionInfo(provider),
    provider: providerInfo(provider),
    assets,
    benchmark: assets.find((asset) => asset.symbol === "SPY") ?? null,
    gainers: byChange.filter((asset) => asset.changePercent > 0).slice(0, 3),
    losers: byChange
      .filter((asset) => asset.changePercent < 0)
      .reverse()
      .slice(0, 3),
    breadth: analysis.breadth,
    evaluation,
    horizonDays: analysis.horizonDays,
  };
}

function toChart(asset: AssetAnalysis): ChartPoint[] {
  const start = Math.max(0, asset.bars.length - CHART_BARS);
  const points: ChartPoint[] = [];
  for (let i = start; i < asset.bars.length; i++) {
    const bar = asset.bars[i];
    const row = asset.features[i];
    if (!bar || !row) continue;
    const r = (value: number | null, decimals = 2) =>
      value === null ? null : round(value, decimals);
    points.push({
      date: bar.date,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      sma20: r(row.sma20),
      sma50: r(row.sma50),
      ema20: r(row.ema20),
      rsi14: r(row.rsi14, 1),
      macd: r(row.macd, 3),
      macdSignal: r(row.macdSignal, 3),
      macdHistogram: r(row.macdHistogram, 3),
      composite: r(row.composite, 3),
    });
  }
  return points;
}

export async function getAssetDetail(symbol: string): Promise<AssetDetail | null> {
  const provider = getMarketDataProvider();
  const normalised = symbol.trim().toUpperCase();
  const analysis = await getUniverseAnalysis();
  const asset = analysis.assets.find((candidate) => candidate.profile.symbol === normalised);
  if (!asset) return null;

  const [quote, ml] = await Promise.all([
    provider.getQuote(normalised),
    getIntelligenceEngine().marketSupplement(normalised, asset.bars, analysis.horizonDays),
  ]);
  const latest = asset.latest;
  return {
    profile: asset.profile,
    quote,
    session: sessionInfo(provider),
    provider: providerInfo(provider),
    signal: asset.signal,
    risk: asset.risk,
    performance: asset.performance,
    signalHistory: asset.signalHistory,
    indicators: {
      close: latest.close,
      sma20: latest.sma20,
      sma50: latest.sma50,
      ema20: latest.ema20,
      rsi14: latest.rsi14,
      macd: latest.macd,
      macdSignal: latest.macdSignal,
      momentum21: latest.momentum21,
      momentum63: latest.momentum63,
      volatility20: latest.volatility20,
      volatility63: latest.volatility63,
      volatilityPercentile: latest.volatilityPercentile,
      trendStrength: latest.trendStrength,
      drawdown: latest.drawdown,
      return1d: latest.return1d,
    },
    chart: toChart(asset),
    calibration: {
      slope: round(analysis.calibration.slope, 4),
      intercept: round(analysis.calibration.intercept, 4),
      samples: analysis.calibration.samples,
      baseRate: round(analysis.calibration.baseRate, 4),
    },
    mlSupplement: ml.supplement,
    engine: ml.engine,
  };
}

export async function listTradableAssets(): Promise<{ symbol: string; name: string }[]> {
  const assets = await getMarketDataProvider().listAssets();
  return assets.map((asset) => ({ symbol: asset.symbol, name: asset.name }));
}
