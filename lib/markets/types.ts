import type { MarketSessionStatus } from "@/lib/clock";
import type { RiskLevel } from "@/lib/risk-levels";

export type AssetClass = "equity" | "etf";

export interface AssetProfile {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  exchange: string;
  sector: string;
  industry: string;
  currency: "USD";
  description: string;
}

/** Daily OHLCV bar. `date` is the trading date (YYYY-MM-DD, New York). */
export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  symbol: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  session: MarketSessionStatus;
  sessionDate: string;
  /** ISO timestamp the quote represents. */
  asOf: string;
  source: "simulated" | "delayed" | "realtime";
}

export type TradeSignal = "BUY" | "HOLD" | "SELL";
export type MarketRegime = "UPTREND" | "DOWNTREND" | "RANGE_BOUND" | "HIGH_VOLATILITY";
export type ExpectedDirection = "UP" | "DOWN" | "SIDEWAYS";

export const REGIME_LABELS: Record<MarketRegime, string> = {
  UPTREND: "Uptrend",
  DOWNTREND: "Downtrend",
  RANGE_BOUND: "Range-bound",
  HIGH_VOLATILITY: "High volatility",
};

export type SignalComponentKey = "trend" | "momentum" | "rsi" | "volatility" | "regime";

export interface ComponentScores {
  trend: number;
  momentum: number;
  rsi: number;
  volatility: number;
  regime: number;
}

/** Per-bar feature snapshot. Every value is computed from data up to and including that bar. */
export interface FeatureRow {
  index: number;
  date: string;
  close: number;
  volume: number;
  return1d: number | null;
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  momentum21: number | null;
  momentum63: number | null;
  volatility20: number | null;
  volatility63: number | null;
  volatilityPercentile: number | null;
  trendStrength: number | null;
  drawdown: number;
  regime: MarketRegime | null;
  scores: ComponentScores | null;
  composite: number | null;
  signal: TradeSignal | null;
}

export interface SignalComponent {
  key: SignalComponentKey;
  label: string;
  weight: number;
  score: number;
  contribution: number;
  value: string;
  interpretation: string;
}

export interface CompositeSignal {
  signal: TradeSignal;
  /** Weighted composite score in [−1, 1]. */
  score: number;
  /** Conviction in [0.05, 0.95] — see methodology. */
  confidence: number;
  /** Calibrated probability that the 20-day forward return is positive. */
  probabilityUp: number;
  expectedDirection: ExpectedDirection;
  /** One-sigma expected move over the horizon, as a ratio (e.g. 0.078 = ±7.8%). */
  expectedMove: number;
  horizonDays: number;
  regime: MarketRegime;
  components: SignalComponent[];
  explanation: string;
  thresholds: { buy: number; sell: number };
  asOf: string;
}

export interface SignalChange {
  date: string;
  from: TradeSignal | null;
  to: TradeSignal;
  score: number;
  price: number;
  /** Return from the change date to the latest close. */
  returnSince: number;
}

export interface AssetRisk {
  score: number;
  level: RiskLevel;
  drivers: { label: string; value: string; contribution: number }[];
}

export interface AssetPerformance {
  change1d: number | null;
  change5d: number | null;
  change1m: number | null;
  change3m: number | null;
  change1y: number | null;
}
