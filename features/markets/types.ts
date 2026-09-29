import type { MarketSessionStatus } from "@/lib/clock";
import type { WalkForwardEvaluation } from "@/lib/markets/calibration";
import type { UniverseBreadth } from "@/lib/markets/analysis";
import type { MarketSupplement, EngineInfo } from "@/lib/ml/engine";
import type {
  AssetPerformance,
  AssetProfile,
  AssetRisk,
  CompositeSignal,
  MarketRegime,
  Quote,
  SignalChange,
  TradeSignal,
} from "@/lib/markets/types";
import type { RiskLevel } from "@/lib/risk-levels";

/** Serializable view models passed from Server Components to Client Components. */

export interface ProviderInfo {
  id: string;
  displayName: string;
  isSimulated: boolean;
}

export interface SessionInfo {
  status: MarketSessionStatus;
  sessionDate: string;
  lastCompletedDate: string;
}

export interface AssetSummary {
  symbol: string;
  name: string;
  sector: string;
  assetClass: string;
  price: number;
  change: number;
  changePercent: number;
  sparkline: number[];
  signal: TradeSignal;
  score: number;
  confidence: number;
  probabilityUp: number;
  regime: MarketRegime;
  riskScore: number;
  riskLevel: RiskLevel;
  volatility20: number | null;
  performance: AssetPerformance;
}

export interface MarketOverview {
  asOf: string;
  session: SessionInfo;
  provider: ProviderInfo;
  assets: AssetSummary[];
  benchmark: AssetSummary | null;
  gainers: AssetSummary[];
  losers: AssetSummary[];
  breadth: UniverseBreadth;
  evaluation: Omit<WalkForwardEvaluation, "reliability" | "timeline">;
  horizonDays: number;
}

export interface ChartPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  composite: number | null;
}

export interface IndicatorSnapshot {
  close: number;
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  momentum21: number | null;
  momentum63: number | null;
  volatility20: number | null;
  volatility63: number | null;
  volatilityPercentile: number | null;
  trendStrength: number | null;
  drawdown: number;
  return1d: number | null;
}

export interface AssetDetail {
  profile: AssetProfile;
  quote: Quote;
  session: SessionInfo;
  provider: ProviderInfo;
  signal: CompositeSignal;
  risk: AssetRisk;
  performance: AssetPerformance;
  signalHistory: SignalChange[];
  indicators: IndicatorSnapshot;
  chart: ChartPoint[];
  calibration: { slope: number; intercept: number; samples: number; baseRate: number };
  mlSupplement: MarketSupplement | null;
  engine: EngineInfo;
}
