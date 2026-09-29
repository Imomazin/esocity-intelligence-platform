import { DataUnavailableError } from "@/lib/api/errors";
import {
  getNow,
  getUsMarketSession,
  sessionCloseAt,
  type MarketSession,
  type TradingCalendar,
} from "@/lib/clock";
import { NYSE_CALENDAR } from "@/lib/markets/calendar";
import type { DailyBarsOptions, MarketDataProvider } from "@/lib/markets/providers/types";
import type { AssetProfile, PriceBar, Quote } from "@/lib/markets/types";

/**
 * Serves licensed market data that ingestion has written to PostgreSQL. Page requests never call
 * the upstream provider: quotas, latency and outages upstream cannot take pages down, and every
 * user sees the same validated data set.
 *
 * The whole universe (profiles + daily bars) is loaded in two queries and cached in memory for
 * `ttlMs`; concurrent requests share one in-flight load. Quotes are the last completed session's
 * close (`source: "delayed"`) — this provider has end-of-day data, not a live feed.
 *
 * Symbols with less than MIN_ANALYSIS_BARS of history are withheld until enough is ingested, so a
 * newly added ticker cannot break the universe-wide analysis.
 */

/** Enough daily history for every signal component (63-day momentum, 60 volatility samples…). */
export const MIN_ANALYSIS_BARS = 130;

export interface StoredMarketRows {
  profiles: AssetProfile[];
  bars: Map<string, PriceBar[]>;
}

export interface MarketSnapshot extends StoredMarketRows {
  version: string;
  loadedAt: number;
  withheld: { symbol: string; bars: number }[];
}

export interface StoredMarketDataProviderOptions {
  id: string;
  displayName: string;
  /** Configured universe, in display order. */
  symbols: readonly string[];
  load: () => Promise<StoredMarketRows>;
  /** Runs before every read, e.g. to opt the current page into request-time rendering. */
  beforeRead?: () => Promise<void>;
  clock?: () => Date;
  calendar?: TradingCalendar;
  ttlMs?: number;
}

/** Cheap content hash of the data set, so any restatement produces a new version. */
function checksum(profiles: readonly AssetProfile[], bars: Map<string, PriceBar[]>): string {
  let hash = 2166136261;
  const mix = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  };
  for (const profile of profiles) {
    mix(profile.symbol);
    for (const bar of bars.get(profile.symbol) ?? []) mix(`${bar.date}${bar.close}${bar.volume}`);
  }
  return (hash >>> 0).toString(36);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export class StoredMarketDataProvider implements MarketDataProvider {
  readonly isSimulated = false;
  private cached: MarketSnapshot | null = null;
  private inflight: Promise<MarketSnapshot> | null = null;

  constructor(private readonly options: StoredMarketDataProviderOptions) {}

  get id(): string {
    return this.options.id;
  }

  get displayName(): string {
    return this.options.displayName;
  }

  private now(): Date {
    return (this.options.clock ?? getNow)();
  }

  get calendar(): TradingCalendar {
    return this.options.calendar ?? NYSE_CALENDAR;
  }

  getSession(): MarketSession {
    return getUsMarketSession(this.now(), this.calendar);
  }

  /** Current snapshot, reloading when older than the TTL (single-flight). */
  async snapshot(): Promise<MarketSnapshot> {
    await this.options.beforeRead?.();
    const ttl = this.options.ttlMs ?? 60_000;
    if (this.cached && Date.now() - this.cached.loadedAt < ttl) return this.cached;
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async load(): Promise<MarketSnapshot> {
    const rows = await this.options.load();
    const lastCompleted = this.getSession().lastCompletedDate;
    const byStoredSymbol = new Map(rows.profiles.map((profile) => [profile.symbol, profile]));
    const profiles: AssetProfile[] = [];
    const bars = new Map<string, PriceBar[]>();
    const withheld: MarketSnapshot["withheld"] = [];
    for (const symbol of this.options.symbols) {
      const profile = byStoredSymbol.get(symbol);
      // Never serve a bar dated after the last completed session.
      const series = (rows.bars.get(symbol) ?? []).filter((bar) => bar.date <= lastCompleted);
      if (!profile || series.length < MIN_ANALYSIS_BARS) {
        withheld.push({ symbol, bars: series.length });
        continue;
      }
      profiles.push(profile);
      bars.set(symbol, series);
    }
    const snapshot: MarketSnapshot = {
      profiles,
      bars,
      withheld,
      version: checksum(profiles, bars),
      loadedAt: Date.now(),
    };
    this.cached = snapshot;
    return snapshot;
  }

  /** Drop the cache (after an ingestion run in this process, and in tests). */
  invalidate(): void {
    this.cached = null;
  }

  async getDataVersion(): Promise<string> {
    return (await this.snapshot()).version;
  }

  async listAssets(): Promise<AssetProfile[]> {
    const snapshot = await this.snapshot();
    if (snapshot.profiles.length === 0) {
      throw new DataUnavailableError(
        `No ${this.displayName} market data has been ingested yet. Run \`pnpm ingest markets\` or wait for the scheduled ingestion job.`,
      );
    }
    return snapshot.profiles.map((profile) => ({ ...profile }));
  }

  async getAsset(symbol: string): Promise<AssetProfile | null> {
    const normalised = symbol.trim().toUpperCase();
    const profile = (await this.snapshot()).profiles.find((item) => item.symbol === normalised);
    return profile ? { ...profile } : null;
  }

  async getDailyBars(symbol: string, options: DailyBarsOptions = {}): Promise<PriceBar[]> {
    let bars = (await this.snapshot()).bars.get(symbol.trim().toUpperCase()) ?? [];
    if (options.from) bars = bars.filter((bar) => bar.date >= (options.from as string));
    if (options.to) bars = bars.filter((bar) => bar.date <= (options.to as string));
    if (options.limit !== undefined) bars = bars.slice(-options.limit);
    return bars.map((bar) => ({ ...bar }));
  }

  async getQuote(symbol: string): Promise<Quote> {
    const normalised = symbol.trim().toUpperCase();
    const bars = (await this.snapshot()).bars.get(normalised);
    const last = bars?.[bars.length - 1];
    if (!bars || !last) throw new Error(`Unknown symbol: ${symbol}`);
    const prior = bars[bars.length - 2] ?? last;
    return {
      symbol: normalised,
      price: last.close,
      previousClose: prior.close,
      change: round2(last.close - prior.close),
      changePercent: last.close / prior.close - 1,
      dayOpen: last.open,
      dayHigh: last.high,
      dayLow: last.low,
      session: this.getSession().status,
      sessionDate: last.date,
      asOf: sessionCloseAt(last.date, this.calendar).toISOString(),
      source: "delayed",
    };
  }
}
