import type { MarketSession } from "@/lib/clock";
import type { AssetProfile, PriceBar, Quote } from "@/lib/markets/types";

/**
 * Market data provider contract. Every market-facing feature (overview, asset detail, signals,
 * paper trading fills, backtests) reads through this interface, so replacing the demo provider
 * with a licensed feed is a matter of implementing it — no UI or engine changes.
 *
 * Implementations must:
 *   • return COMPLETED daily bars only, ascending by date, with no gaps other than holidays;
 *   • never return data dated after the provider's notion of "now" (no look-ahead);
 *   • normalise symbols to upper case;
 *   • throw ProviderError (not raw HTTP errors) on upstream failures.
 */
export interface MarketDataProvider {
  readonly id: string;
  readonly displayName: string;
  /** True when prices are simulated — the UI labels simulated data prominently. */
  readonly isSimulated: boolean;

  listAssets(): Promise<AssetProfile[]>;
  getAsset(symbol: string): Promise<AssetProfile | null>;
  getDailyBars(symbol: string, options?: DailyBarsOptions): Promise<PriceBar[]>;
  getQuote(symbol: string): Promise<Quote>;
  getSession(): MarketSession;
}

export interface DailyBarsOptions {
  /** Inclusive start date (YYYY-MM-DD). */
  from?: string;
  /** Inclusive end date (YYYY-MM-DD). */
  to?: string;
  /** Return at most the last `limit` bars (applied after from/to). */
  limit?: number;
}

export class ProviderError extends Error {
  constructor(
    public readonly providerId: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`[${providerId}] ${message}`, options);
    this.name = "ProviderError";
  }
}
