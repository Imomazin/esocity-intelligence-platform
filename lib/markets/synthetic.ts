import { businessDaysBetween } from "@/lib/clock";
import type { PriceBar } from "@/lib/markets/types";
import { findDemoAsset, type SyntheticParameters } from "@/lib/markets/universe";
import { createRng } from "@/lib/quant/random";

/**
 * Deterministic synthetic market generator.
 *
 * Model (daily, business days from SYNTHETIC_EPOCH):
 *   • Market factor: persistent 3-state Markov regime (bull / neutral / bear; expected durations
 *     ≈ 7 / 5 / 3 months) with regime-specific drift and volatility, plus GARCH(1,1)-style
 *     volatility clustering.
 *   • Asset return: α + β·(market) + a slowly varying latent idiosyncratic drift (Ornstein–
 *     Uhlenbeck, half-life ≈ 6 months) + idiosyncratic shock with its own GARCH multiplier + a weak
 *     mean reversion toward a growth anchor so multi-year paths stay plausible.
 *   • OHLC and volume are derived consistently from the close-to-close path.
 *
 * The persistent regimes and latent drift deliberately embed MODEST time-series momentum — a
 * well-documented property of real markets — so trend-based models have a small, realistic edge
 * rather than none or an implausibly large one. Metrics computed on this data demonstrate the
 * evaluation pipeline; they say nothing about performance on real markets.
 *
 * Paths are generated sequentially from a fixed epoch with per-asset seeded streams, so the bar
 * for any given date is identical no matter when it is requested — history "grows" by one bar
 * each business day, exactly like a real feed. None of this is real market data.
 */

export const SYNTHETIC_EPOCH = "2022-01-03";
const TRADING_DAYS = 252;
const SQRT_TRADING_DAYS = Math.sqrt(TRADING_DAYS);

type FactorRegime = "BULL" | "NEUTRAL" | "BEAR";

const FACTOR_REGIMES: Record<FactorRegime, { drift: number; vol: number }> = {
  BULL: { drift: 0.18, vol: 0.12 },
  NEUTRAL: { drift: 0.04, vol: 0.16 },
  BEAR: { drift: -0.25, vol: 0.25 },
};

/** Daily transition probabilities (rows sum to 1). */
const FACTOR_TRANSITIONS: Record<FactorRegime, [FactorRegime, number][]> = {
  BULL: [
    ["BULL", 0.993],
    ["NEUTRAL", 0.006],
    ["BEAR", 0.001],
  ],
  NEUTRAL: [
    ["BULL", 0.006],
    ["NEUTRAL", 0.99],
    ["BEAR", 0.004],
  ],
  BEAR: [
    ["BULL", 0.003],
    ["NEUTRAL", 0.012],
    ["BEAR", 0.985],
  ],
};

/** Latent idiosyncratic drift: OU with ≈126-day half-life and 22% (annualised) stationary std. */
const DRIFT_PERSISTENCE = Math.pow(0.5, 1 / 126);
const DRIFT_STATIONARY_STD = 0.22;
const DRIFT_INNOVATION_STD = DRIFT_STATIONARY_STD * Math.sqrt(1 - DRIFT_PERSISTENCE ** 2);

/**
 * Stream seeds. Chosen by scanning candidates for a plausible, balanced present-day demo market.
 * Changing either rewrites every demo price history.
 */
const FACTOR_SEED = "v28";
const ASSET_SEED = "v2";
const GARCH_ALPHA = 0.08;
const GARCH_BETA = 0.9;
const GARCH_OMEGA = 1 - GARCH_ALPHA - GARCH_BETA; // unit long-run variance multiplier
const MEAN_REVERSION_SPEED = 0.1; // per year — weak; only prevents multi-year drift

function transition<S extends string>(state: S, table: Record<S, [S, number][]>, u: number): S {
  let cumulative = 0;
  for (const [next, probability] of table[state]) {
    cumulative += probability;
    if (u < cumulative) return next;
  }
  return state;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface FactorDay {
  date: string;
  logReturn: number;
  sigma: number;
  regime: FactorRegime;
}

function generateMarketFactor(dates: readonly string[]): FactorDay[] {
  const rng = createRng(`esocity:market-factor:${FACTOR_SEED}`);
  let regime: FactorRegime = "NEUTRAL";
  let varianceMultiplier = 1;
  const days: FactorDay[] = [];

  for (const date of dates) {
    const u = rng.next();
    const z = rng.normal();
    regime = transition(regime, FACTOR_TRANSITIONS, u);
    const params = FACTOR_REGIMES[regime];
    const sigma = (params.vol / SQRT_TRADING_DAYS) * Math.sqrt(varianceMultiplier);
    const logReturn = params.drift / TRADING_DAYS - 0.5 * sigma * sigma + sigma * z;
    days.push({ date, logReturn, sigma, regime });
    varianceMultiplier = GARCH_OMEGA + GARCH_ALPHA * z * z + GARCH_BETA * varianceMultiplier;
  }
  return days;
}

function generateAssetBars(
  symbol: string,
  params: SyntheticParameters,
  factor: readonly FactorDay[],
): PriceBar[] {
  const rng = createRng(`esocity:asset:${symbol}:${ASSET_SEED}`);
  let logPrice = Math.log(params.startPrice);
  let anchor = logPrice;
  let latentDrift = 0;
  let varianceMultiplier = 1;
  const bars: PriceBar[] = [];

  for (const day of factor) {
    // Fixed number of draws per day keeps every stream aligned regardless of state.
    const zDrift = rng.normal();
    const zIdio = rng.normal();
    const zGap = rng.normal();
    const zHigh = rng.normal();
    const zLow = rng.normal();
    const zVolume = rng.normal();

    if (params.idiosyncraticDrift) {
      latentDrift = DRIFT_PERSISTENCE * latentDrift + DRIFT_INNOVATION_STD * zDrift;
    }

    const sigmaIdio = (params.idioVol / SQRT_TRADING_DAYS) * Math.sqrt(varianceMultiplier);
    const meanReversion = (-MEAN_REVERSION_SPEED * (logPrice - anchor)) / TRADING_DAYS;
    const logReturn =
      (params.alpha + latentDrift) / TRADING_DAYS +
      params.beta * day.logReturn +
      sigmaIdio * zIdio -
      0.5 * sigmaIdio * sigmaIdio +
      meanReversion;

    const previousClose = Math.exp(logPrice);
    logPrice += logReturn;
    anchor += params.anchorGrowth / TRADING_DAYS;
    const close = Math.exp(logPrice);

    const sigmaTotal = Math.sqrt((params.beta * day.sigma) ** 2 + sigmaIdio ** 2);
    const open = previousClose * Math.exp(0.3 * logReturn + 0.25 * sigmaTotal * zGap);
    const roundedOpen = round2(open);
    const roundedClose = round2(close);
    const high = Math.max(
      roundedOpen,
      roundedClose,
      round2(Math.max(open, close) * Math.exp(Math.abs(zHigh) * 0.4 * sigmaTotal)),
    );
    const low = Math.min(
      roundedOpen,
      roundedClose,
      round2(Math.min(open, close) * Math.exp(-Math.abs(zLow) * 0.4 * sigmaTotal)),
    );

    const shock = Math.min(Math.abs(logReturn) / sigmaTotal, 4);
    const volume = Math.round(params.baseVolume * (0.7 + 0.3 * shock) * Math.exp(0.18 * zVolume));

    bars.push({ date: day.date, open: roundedOpen, high, low, close: roundedClose, volume });
    varianceMultiplier =
      GARCH_OMEGA + GARCH_ALPHA * zIdio * zIdio + GARCH_BETA * varianceMultiplier;
  }

  return bars;
}

// ─── Memoisation ─────────────────────────────────────────────────────────────────────────────

const MAX_CACHE_ENTRIES = 64;
const factorCache = new Map<string, FactorDay[]>();
const barCache = new Map<string, PriceBar[]>();

function remember<T>(cache: Map<string, T>, key: string, compute: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit;
  const value = compute();
  cache.set(key, value);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return value;
}

export function getMarketFactor(throughDate: string): FactorDay[] {
  return remember(factorCache, throughDate, () =>
    generateMarketFactor(businessDaysBetween(SYNTHETIC_EPOCH, throughDate)),
  );
}

/**
 * Full synthetic daily history for `symbol` from the epoch through `throughDate` (inclusive).
 * Returned arrays are shared from the cache — treat them as read-only.
 */
export function generateSyntheticHistory(symbol: string, throughDate: string): readonly PriceBar[] {
  const asset = findDemoAsset(symbol);
  if (!asset) throw new Error(`Unknown demo symbol: ${symbol}`);
  return remember(barCache, `${asset.profile.symbol}:${throughDate}`, () =>
    generateAssetBars(asset.profile.symbol, asset.synthetic, getMarketFactor(throughDate)),
  );
}

// ─── Intraday simulation (for "live" demo quotes) ───────────────────────────────────────────

export const INTRADAY_STEPS = 78; // 5-minute steps across a 6.5-hour session

/**
 * Deterministic intraday price path for one session: a Brownian bridge in log-price from the
 * day's open to its close, so the path always ends exactly at the daily bar's close.
 */
export function simulateIntradayPath(symbol: string, bar: PriceBar): number[] {
  const rng = createRng(`esocity:intraday:${symbol}:${bar.date}:v1`);
  const logOpen = Math.log(bar.open);
  const logClose = Math.log(bar.close);
  const dailySigma = Math.max(Math.log(bar.high / bar.low) / 2, 0.002);
  const scale = (dailySigma * 0.6) / Math.sqrt(INTRADAY_STEPS);

  const walk = [0];
  for (let k = 1; k <= INTRADAY_STEPS; k++) {
    walk.push((walk[k - 1] as number) + rng.normal());
  }
  const terminal = walk[INTRADAY_STEPS] as number;

  return walk.map((w, k) => {
    const t = k / INTRADAY_STEPS;
    const bridge = w - t * terminal;
    return Math.exp(logOpen + t * (logClose - logOpen) + scale * bridge);
  });
}

export function intradayPointAt(
  path: readonly number[],
  fraction: number,
): { price: number; high: number; low: number } {
  const clamped = Math.min(1, Math.max(0, fraction));
  const position = clamped * (path.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(path.length - 1, lower + 1);
  const weight = position - lower;
  const price = (path[lower] as number) * (1 - weight) + (path[upper] as number) * weight;
  const seen = path.slice(0, lower + 1);
  seen.push(price);
  return { price: round2(price), high: round2(Math.max(...seen)), low: round2(Math.min(...seen)) };
}
