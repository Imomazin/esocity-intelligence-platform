import { tradingDaysBetween } from "@/lib/clock";
import { NYSE_CALENDAR } from "@/lib/markets/calendar";
import type {
  BarCoverage,
  MarketDataRepository,
  MarketHistorySource,
  StoredAsset,
  UpstreamAssetProfile,
} from "@/lib/markets/ingestion";
import type { PriceBar } from "@/lib/markets/types";

/** Deterministic daily bar for a symbol and NYSE trading date (smooth, strictly positive). */
export function fakeBar(symbol: string, date: string, splitFactor = 1): PriceBar {
  const day = Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  const seed = [...symbol].reduce((total, char) => total + char.charCodeAt(0), 0);
  const close = (100 + (seed % 50) + 10 * Math.sin(day / 17 + seed)) / splitFactor;
  const open = close * (1 + 0.003 * Math.cos(day));
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return {
    date,
    open: round(open),
    high: round(Math.max(open, close) * 1.01),
    low: round(Math.min(open, close) * 0.99),
    close: round(close),
    volume: 1_000_000 + (Math.round(day) % 7) * 1_000,
  };
}

export class FakeHistorySource implements MarketHistorySource {
  readonly id = "fake";
  readonly displayName = "Fake provider";
  requestCount = 0;
  /** Trading dates on or after which a split is visible in (restated) history. */
  split: { symbol: string; factor: number } | null = null;
  unknown = new Set<string>();
  failing = new Map<string, Error>();
  fetches: { symbol: string; from: string; to: string }[] = [];
  /** Extra raw bars appended to responses (e.g. a forming bar for today). */
  extra: PriceBar[] = [];

  async fetchProfile(symbol: string): Promise<UpstreamAssetProfile | null> {
    this.requestCount += 1;
    if (this.unknown.has(symbol)) return null;
    return {
      symbol,
      name: `${symbol} Holdings`,
      assetClass: "equity",
      exchange: "NASDAQ",
      sector: "Manufacturing",
      industry: "Widgets",
      currency: "USD",
      description: `${symbol} test instrument.`,
      metadata: { provider: "fake" },
    };
  }

  async fetchDailyBars(symbol: string, from: string, to: string): Promise<PriceBar[]> {
    this.requestCount += 1;
    this.fetches.push({ symbol, from, to });
    const failure = this.failing.get(symbol);
    if (failure) throw failure;
    const factor = this.split?.symbol === symbol ? this.split.factor : 1;
    return [
      ...tradingDaysBetween(NYSE_CALENDAR, from, to).map((date) => fakeBar(symbol, date, factor)),
      ...this.extra.filter((bar) => bar.date >= from),
    ];
  }
}

/** In-memory MarketDataRepository mirroring the PostgreSQL semantics. */
export class MemoryMarketRepository implements MarketDataRepository {
  assets = new Map<string, StoredAsset & { profile: UpstreamAssetProfile }>();
  bars = new Map<string, Map<string, PriceBar & { source: string }>>();
  replaced = 0;

  async findAssets(symbols: readonly string[]): Promise<Map<string, StoredAsset>> {
    return new Map(
      symbols.flatMap((symbol) => {
        const asset = this.assets.get(symbol);
        return asset ? [[symbol, { id: asset.id, symbol }] as const] : [];
      }),
    );
  }

  async createAsset(profile: UpstreamAssetProfile): Promise<StoredAsset> {
    const asset = { id: `asset-${profile.symbol}`, symbol: profile.symbol, profile };
    this.assets.set(profile.symbol, asset);
    return { id: asset.id, symbol: asset.symbol };
  }

  private series(assetId: string) {
    let series = this.bars.get(assetId);
    if (!series) {
      series = new Map();
      this.bars.set(assetId, series);
    }
    return series;
  }

  stored(assetId: string, source: string): PriceBar[] {
    return [...this.series(assetId).values()]
      .filter((bar) => bar.source === source)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ source: _source, ...bar }) => bar);
  }

  async coverage(assetId: string, source: string): Promise<BarCoverage> {
    const bars = this.stored(assetId, source);
    return {
      first: bars[0]?.date ?? null,
      last: bars[bars.length - 1]?.date ?? null,
      count: bars.length,
    };
  }

  async readBars(assetId: string, source: string, from: string, to: string): Promise<PriceBar[]> {
    return this.stored(assetId, source).filter((bar) => bar.date >= from && bar.date <= to);
  }

  async upsertBars(assetId: string, source: string, bars: readonly PriceBar[]): Promise<number> {
    const series = this.series(assetId);
    for (const bar of bars) series.set(bar.date, { ...bar, source });
    return bars.length;
  }

  async replaceBars(assetId: string, source: string, bars: readonly PriceBar[]): Promise<number> {
    this.replaced += 1;
    const series = this.series(assetId);
    for (const [date, bar] of series) if (bar.source === source) series.delete(date);
    return this.upsertBars(assetId, source, bars);
  }
}
