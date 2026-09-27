import "server-only";

import { getUniverseAnalysis } from "@/features/markets/queries";
import { getSportsOverview } from "@/features/sports/queries";
import { getNow, toIsoDate } from "@/lib/clock";
import { getServerEnv } from "@/lib/env";
import type { ReliabilityBin } from "@/lib/markets/calibration";
import { REGIME_LABELS, type MarketRegime } from "@/lib/markets/types";
import { getIntelligenceEngine, type EngineHealth } from "@/lib/ml/engine";
import { MODEL_CARDS, type ModelCard } from "@/lib/models/registry";

export interface ModelMetric {
  label: string;
  value: string;
  note?: string;
  tone?: "positive" | "negative" | "neutral";
}

export interface CalibrationPoint {
  label: string;
  predicted: number;
  observed: number;
  count: number;
}

export interface ModelLabEntry {
  card: ModelCard;
  lastEvaluated: string | null;
  evaluationNote: string;
  metrics: ModelMetric[];
  calibration: CalibrationPoint[];
  runtimeStatus: "online" | "offline" | "embedded";
}

export interface ModelLabView {
  entries: ModelLabEntry[];
  mlService: EngineHealth & { configured: boolean };
}

function pct(value: number | null, digits = 1): string {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function signedPct(value: number | null, digits = 1): string {
  if (value === null) return "—";
  const magnitude = `${Math.abs(value * 100).toFixed(digits)}%`;
  return value > 0 ? `+${magnitude}` : value < 0 ? `−${magnitude}` : magnitude;
}

function calibrationPoints(bins: readonly ReliabilityBin[]): CalibrationPoint[] {
  return bins
    .filter((bin) => bin.count > 0 && bin.meanPredicted !== null && bin.observedFrequency !== null)
    .map((bin) => ({
      label: `${Math.round(bin.lower * 100)}–${Math.round(bin.upper * 100)}%`,
      predicted: bin.meanPredicted as number,
      observed: bin.observedFrequency as number,
      count: bin.count,
    }));
}

export async function getModelLabView(): Promise<ModelLabView> {
  const env = getServerEnv();
  const [universe, sports, mlHealth] = await Promise.all([
    getUniverseAnalysis(),
    getSportsOverview(),
    getIntelligenceEngine().health(),
  ]);
  const markets = universe.evaluation;
  const football = sports.evaluation;

  // Regime statistics across every feature row in the universe.
  const regimeCounts: Record<MarketRegime, number> = {
    UPTREND: 0,
    DOWNTREND: 0,
    RANGE_BOUND: 0,
    HIGH_VOLATILITY: 0,
  };
  let runs = 0;
  let classified = 0;
  for (const asset of universe.assets) {
    let previous: MarketRegime | null = null;
    for (const row of asset.features) {
      if (!row.regime) continue;
      classified += 1;
      regimeCounts[row.regime] += 1;
      if (row.regime !== previous) runs += 1;
      previous = row.regime;
    }
  }
  const averagePersistence = runs > 0 ? classified / runs : 0;

  const entries: ModelLabEntry[] = MODEL_CARDS.map((card) => {
    switch (card.key) {
      case "markets.composite-signal":
        return {
          card,
          lastEvaluated: universe.asOf,
          evaluationNote: `Walk-forward ${markets.evaluationStart ?? "—"} → ${markets.evaluationEnd ?? "—"} · synthetic demo data`,
          runtimeStatus: "embedded",
          calibration: calibrationPoints(markets.reliability),
          metrics: [
            {
              label: "Directional hit rate",
              value: pct(markets.directionalHitRate),
              note: `${markets.directionalCalls.toLocaleString("en-US")} BUY/SELL calls, ${universe.horizonDays}-day horizon`,
            },
            {
              label: "Brier skill vs base rate",
              value: signedPct(markets.brierSkillScore, 2),
              tone: (markets.brierSkillScore ?? 0) > 0 ? "positive" : "negative",
              note: "Positive = better than always predicting the historical base rate",
            },
            {
              label: "Brier score",
              value: markets.brierScore?.toFixed(4) ?? "—",
              note: `Base rate: ${markets.baselineBrierScore?.toFixed(4) ?? "—"}`,
            },
            { label: "Log loss", value: markets.logLoss?.toFixed(4) ?? "—" },
            {
              label: "Out-of-sample predictions",
              value: markets.predictions.toLocaleString("en-US"),
            },
          ],
        };
      case "markets.regime-classifier":
        return {
          card,
          lastEvaluated: universe.asOf,
          evaluationNote: "Descriptive statistics across the demo universe history",
          runtimeStatus: "embedded",
          calibration: [],
          metrics: [
            ...(Object.keys(regimeCounts) as MarketRegime[]).map((regime) => ({
              label: `${REGIME_LABELS[regime]} share`,
              value: pct(classified ? regimeCounts[regime] / classified : null),
            })),
            { label: "Average regime persistence", value: `${averagePersistence.toFixed(1)} days` },
          ],
        };
      case "sports.poisson-dixon-coles":
        return {
          card,
          lastEvaluated: toIsoDate(getNow()),
          evaluationNote: `${football.matches} finished demo matches, predictions made before kick-off`,
          runtimeStatus: "embedded",
          calibration: calibrationPoints(football.reliability),
          metrics: [
            {
              label: "1X2 accuracy",
              value: pct(football.accuracy),
              note: "Most likely outcome occurred",
            },
            {
              label: "Brier skill vs base rates",
              value: signedPct(football.brierSkillScore, 1),
              tone: (football.brierSkillScore ?? 0) > 0 ? "positive" : "negative",
            },
            {
              label: "Brier score (1X2)",
              value: football.brierScore?.toFixed(4) ?? "—",
              note: `Base rates: ${football.baselineBrierScore?.toFixed(4) ?? "—"}`,
            },
            { label: "Log loss", value: football.logLoss?.toFixed(4) ?? "—" },
            {
              label: "Over 2.5 Brier",
              value: football.over25Brier?.toFixed(4) ?? "—",
              note: `Base rate: ${football.over25BaselineBrier?.toFixed(4) ?? "—"}`,
            },
            { label: "Average confidence", value: pct(football.averageConfidence, 0) },
          ],
        };
      case "sports.team-ratings":
        return {
          card,
          lastEvaluated: toIsoDate(getNow()),
          evaluationNote: "Estimated before each round from earlier results only",
          runtimeStatus: "embedded",
          calibration: [],
          metrics: sports.competitions.flatMap((competition) => [
            {
              label: `${competition.shortName} baseline goals`,
              value: competition.baselineGoals.toFixed(2),
              note: "Prior (per team per match)",
            },
            {
              label: `${competition.shortName} home advantage`,
              value: `×${competition.homeAdvantage.toFixed(2)}`,
              note: "Prior home/away goal ratio",
            },
          ]),
        };
      default:
        return {
          card,
          lastEvaluated: null,
          evaluationNote: env.ML_API_URL
            ? "Evaluated per request by the Python ML service"
            : "ML_API_URL not configured — the service is optional",
          runtimeStatus: mlHealth.status === "up" ? "online" : "offline",
          calibration: [],
          metrics: [
            {
              label: "Service status",
              value:
                mlHealth.status === "up"
                  ? "Online"
                  : env.ML_API_URL
                    ? "Unreachable"
                    : "Not configured",
            },
            ...(mlHealth.version ? [{ label: "Service version", value: mlHealth.version }] : []),
            ...(mlHealth.xgboostAvailable !== undefined
              ? [
                  {
                    label: "Gradient boosting backend",
                    value: mlHealth.xgboostAvailable ? "XGBoost" : "scikit-learn",
                  },
                ]
              : []),
          ],
        };
    }
  });

  return { entries, mlService: { ...mlHealth, configured: Boolean(env.ML_API_URL) } };
}
