import {
  buildCalibrationSamples,
  calibratedProbability,
  fitCalibrationModel,
  walkForwardEvaluate,
  type CalibrationModel,
  type CalibrationSample,
  type WalkForwardEvaluation,
} from "@/lib/markets/calibration";
import { computeAssetRisk } from "@/lib/markets/risk";
import {
  buildCompositeSignal,
  buildFeatureRows,
  SIGNAL_HORIZON_DAYS,
} from "@/lib/markets/signal-engine";
import type {
  AssetPerformance,
  AssetProfile,
  AssetRisk,
  CompositeSignal,
  FeatureRow,
  MarketRegime,
  PriceBar,
  SignalChange,
  TradeSignal,
} from "@/lib/markets/types";
import { round } from "@/lib/quant/stats";

export interface AssetAnalysis {
  profile: AssetProfile;
  bars: readonly PriceBar[];
  features: FeatureRow[];
  latest: FeatureRow;
  signal: CompositeSignal;
  risk: AssetRisk;
  performance: AssetPerformance;
  signalHistory: SignalChange[];
}

export interface UniverseBreadth {
  assets: number;
  aboveSma50: number;
  advancing: number;
  declining: number;
  averageScore: number;
  signalCounts: Record<TradeSignal, number>;
  regimeCounts: Record<MarketRegime, number>;
}

export interface UniverseAnalysis {
  asOf: string;
  horizonDays: number;
  assets: AssetAnalysis[];
  calibration: CalibrationModel;
  evaluation: WalkForwardEvaluation;
  breadth: UniverseBreadth;
}

function change(bars: readonly PriceBar[], lookback: number): number | null {
  const last = bars[bars.length - 1];
  const base = bars[bars.length - 1 - lookback];
  if (!last || !base) return null;
  return round(last.close / base.close - 1, 6);
}

export function computePerformance(bars: readonly PriceBar[]): AssetPerformance {
  return {
    change1d: change(bars, 1),
    change5d: change(bars, 5),
    change1m: change(bars, 21),
    change3m: change(bars, 63),
    change1y: change(bars, 252),
  };
}

/** Signal transitions over the trailing window, most recent first. */
export function extractSignalHistory(
  rows: readonly FeatureRow[],
  window = 260,
  limit = 10,
): SignalChange[] {
  const latestClose = rows[rows.length - 1]?.close ?? 0;
  const start = Math.max(0, rows.length - window);
  const changes: SignalChange[] = [];
  let previous: TradeSignal | null = null;
  for (let i = start; i < rows.length; i++) {
    const row = rows[i] as FeatureRow;
    if (row.signal === null || row.composite === null) continue;
    // The first defined signal in the window only establishes the baseline state.
    if (previous !== null && row.signal !== previous) {
      changes.push({
        date: row.date,
        from: previous,
        to: row.signal,
        score: round(row.composite, 4),
        price: row.close,
        returnSince: latestClose > 0 ? round(latestClose / row.close - 1, 6) : 0,
      });
    }
    previous = row.signal;
  }
  return changes.reverse().slice(0, limit);
}

/**
 * Analyse the whole universe: features per asset, pooled walk-forward calibration, the latest
 * explainable signal per asset, risk, performance and breadth.
 */
export function analyzeUniverse(
  inputs: readonly { profile: AssetProfile; bars: readonly PriceBar[] }[],
  options: { horizonDays?: number } = {},
): UniverseAnalysis {
  const horizonDays = options.horizonDays ?? SIGNAL_HORIZON_DAYS;
  const prepared = inputs.map(({ profile, bars }) => ({
    profile,
    bars,
    features: buildFeatureRows(bars),
  }));

  const asOf = prepared.reduce((latest, item) => {
    const date = item.bars[item.bars.length - 1]?.date ?? "";
    return date > latest ? date : latest;
  }, "");

  const samples: CalibrationSample[] = prepared.flatMap((item) =>
    buildCalibrationSamples(item.profile.symbol, item.features, horizonDays),
  );
  const calibration = fitCalibrationModel(samples, asOf, horizonDays);
  const evaluation = walkForwardEvaluate(samples, { horizonDays });

  const assets: AssetAnalysis[] = prepared.map(({ profile, bars, features }) => {
    const latest = features[features.length - 1];
    if (!latest || latest.composite === null) {
      throw new Error(`Not enough history to analyse ${profile.symbol}`);
    }
    return {
      profile,
      bars,
      features,
      latest,
      signal: buildCompositeSignal(latest, {
        symbol: profile.symbol,
        probabilityUp: calibratedProbability(calibration, latest.composite),
        horizonDays,
      }),
      risk: computeAssetRisk(latest, bars),
      performance: computePerformance(bars),
      signalHistory: extractSignalHistory(features),
    };
  });

  const signalCounts: Record<TradeSignal, number> = { BUY: 0, HOLD: 0, SELL: 0 };
  const regimeCounts: Record<MarketRegime, number> = {
    UPTREND: 0,
    DOWNTREND: 0,
    RANGE_BOUND: 0,
    HIGH_VOLATILITY: 0,
  };
  let aboveSma50 = 0;
  let advancing = 0;
  let declining = 0;
  let scoreSum = 0;
  for (const asset of assets) {
    signalCounts[asset.signal.signal] += 1;
    regimeCounts[asset.signal.regime] += 1;
    if (asset.latest.sma50 !== null && asset.latest.close > asset.latest.sma50) aboveSma50 += 1;
    if ((asset.performance.change1d ?? 0) > 0) advancing += 1;
    if ((asset.performance.change1d ?? 0) < 0) declining += 1;
    scoreSum += asset.signal.score;
  }

  return {
    asOf,
    horizonDays,
    assets,
    calibration,
    evaluation,
    breadth: {
      assets: assets.length,
      aboveSma50,
      advancing,
      declining,
      averageScore: assets.length ? round(scoreSum / assets.length, 4) : 0,
      signalCounts,
      regimeCounts,
    },
  };
}
