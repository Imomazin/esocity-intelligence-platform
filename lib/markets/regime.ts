import type { MarketRegime } from "@/lib/markets/types";

export interface RegimeInputs {
  close: number;
  sma20: number;
  sma50: number;
  trendStrength: number;
  /** Percentile of current 20-day volatility within its trailing one-year range, in [0, 1]. */
  volatilityPercentile: number;
}

/** Published regime thresholds. */
export const REGIME_RULES = {
  highVolatilityPercentile: 0.9,
  trendStrengthThreshold: 0.15,
} as const;

/**
 * Rule-based market regime classification (evaluated in order):
 *   1. HIGH_VOLATILITY — 20-day volatility in the top decile of its one-year range.
 *   2. UPTREND — price above the 50-day average, 20-day above 50-day, trend strength > +0.15.
 *   3. DOWNTREND — price below the 50-day average, 20-day below 50-day, trend strength < −0.15.
 *   4. RANGE_BOUND — everything else.
 */
export function classifyRegime(inputs: RegimeInputs): MarketRegime {
  if (inputs.volatilityPercentile >= REGIME_RULES.highVolatilityPercentile) {
    return "HIGH_VOLATILITY";
  }
  if (
    inputs.close > inputs.sma50 &&
    inputs.sma20 > inputs.sma50 &&
    inputs.trendStrength > REGIME_RULES.trendStrengthThreshold
  ) {
    return "UPTREND";
  }
  if (
    inputs.close < inputs.sma50 &&
    inputs.sma20 < inputs.sma50 &&
    inputs.trendStrength < -REGIME_RULES.trendStrengthThreshold
  ) {
    return "DOWNTREND";
  }
  return "RANGE_BOUND";
}

export const REGIME_DESCRIPTIONS: Record<MarketRegime, string> = {
  UPTREND: "Trend-following conditions: price and moving averages aligned upward.",
  DOWNTREND: "Defensive conditions: price and moving averages aligned downward.",
  RANGE_BOUND: "No persistent trend: price oscillating around its averages.",
  HIGH_VOLATILITY: "Stressed conditions: volatility in the top decile of its one-year range.",
};
