import type { FeatureRow, TradeSignal } from "@/lib/markets/types";
import { clamp, fitLogistic1D, logistic, mean, round } from "@/lib/quant/stats";

/**
 * Probability calibration for the composite signal.
 *
 * Maps composite score → P(forward return over the horizon > 0) with a one-feature logistic
 * regression (ridge-penalised toward "no edge"), fitted on the pooled universe.
 *
 * Leakage rule: a sample dated t has a label that only becomes known at t + horizon
 * (`labelDate`). Any model used on date D is trained exclusively on samples with
 * labelDate ≤ D. Walk-forward evaluation enforces the same rule, so reported metrics are
 * genuinely out-of-sample.
 */

export interface CalibrationSample {
  symbol: string;
  date: string;
  labelDate: string;
  score: number;
  signal: TradeSignal;
  forwardReturn: number;
  outcome: 0 | 1;
}

export interface CalibrationModel {
  intercept: number;
  slope: number;
  samples: number;
  baseRate: number;
  trainedThrough: string | null;
  horizonDays: number;
}

export interface ReliabilityBin {
  lower: number;
  upper: number;
  count: number;
  meanPredicted: number | null;
  observedFrequency: number | null;
}

export interface WalkForwardEvaluation {
  predictions: number;
  evaluationStart: string | null;
  evaluationEnd: string | null;
  brierScore: number | null;
  baselineBrierScore: number | null;
  /** 1 − Brier / Brier(climatology). > 0 means the model beats the base rate. */
  brierSkillScore: number | null;
  logLoss: number | null;
  /** Share of BUY/SELL calls whose direction matched the realised forward return. */
  directionalHitRate: number | null;
  directionalCalls: number;
  buyHitRate: number | null;
  sellHitRate: number | null;
  reliability: ReliabilityBin[];
}

const PROBABILITY_FLOOR = 0.02;
/**
 * Ridge penalty on the slope. Overlapping horizon windows make consecutive samples highly
 * dependent (each carries roughly 1/horizon of an independent observation), so the penalty is
 * scaled by the horizon to reflect the effective sample size.
 */
const BASE_L2_PENALTY = 5;
const RELIABILITY_EDGES = [0, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 1];

export function buildCalibrationSamples(
  symbol: string,
  rows: readonly FeatureRow[],
  horizonDays: number,
): CalibrationSample[] {
  const samples: CalibrationSample[] = [];
  for (let i = 0; i + horizonDays < rows.length; i++) {
    const row = rows[i] as FeatureRow;
    const future = rows[i + horizonDays] as FeatureRow;
    if (row.composite === null || row.signal === null) continue;
    const forwardReturn = future.close / row.close - 1;
    samples.push({
      symbol,
      date: row.date,
      labelDate: future.date,
      score: row.composite,
      signal: row.signal,
      forwardReturn,
      outcome: forwardReturn > 0 ? 1 : 0,
    });
  }
  return samples;
}

/** Fit on every sample whose label is known by `asOfDate`. */
export function fitCalibrationModel(
  samples: readonly CalibrationSample[],
  asOfDate: string,
  horizonDays: number,
): CalibrationModel {
  const training = samples.filter((sample) => sample.labelDate <= asOfDate);
  if (training.length < 50) {
    return {
      intercept: 0,
      slope: 0,
      samples: training.length,
      baseRate: 0.5,
      trainedThrough: null,
      horizonDays,
    };
  }
  const fit = fitLogistic1D(
    training.map((sample) => sample.score),
    training.map((sample) => sample.outcome),
    { l2: BASE_L2_PENALTY * horizonDays },
  );
  const trainedThrough = training.reduce(
    (latest, sample) => (sample.labelDate > latest ? sample.labelDate : latest),
    training[0]?.labelDate ?? asOfDate,
  );
  return {
    intercept: fit.intercept,
    slope: fit.slope,
    samples: training.length,
    baseRate: mean(training.map((sample) => sample.outcome)),
    trainedThrough,
    horizonDays,
  };
}

export function calibratedProbability(model: CalibrationModel, score: number): number {
  return clamp(
    logistic(model.intercept + model.slope * score),
    PROBABILITY_FLOOR,
    1 - PROBABILITY_FLOOR,
  );
}

function emptyBins(): ReliabilityBin[] {
  return RELIABILITY_EDGES.slice(0, -1).map((lower, i) => ({
    lower,
    upper: RELIABILITY_EDGES[i + 1] as number,
    count: 0,
    meanPredicted: null,
    observedFrequency: null,
  }));
}

/**
 * Expanding-window walk-forward evaluation. The model is refitted every `refitEvery` distinct
 * sample dates using only labels known at the refit date; predictions for the following block
 * are scored against realised outcomes.
 */
export function walkForwardEvaluate(
  samples: readonly CalibrationSample[],
  options: { minTrainingSamples?: number; refitEvery?: number; horizonDays: number },
): WalkForwardEvaluation {
  const { minTrainingSamples = 1_000, refitEvery = 63, horizonDays } = options;
  const sorted = [...samples].sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...new Set(sorted.map((sample) => sample.date))];
  const byDate = new Map<string, CalibrationSample[]>();
  for (const sample of sorted) {
    const bucket = byDate.get(sample.date);
    if (bucket) bucket.push(sample);
    else byDate.set(sample.date, [sample]);
  }

  const scored: { p: number; y: number; base: number; sample: CalibrationSample }[] = [];
  let model: CalibrationModel | null = null;
  let sinceRefit = refitEvery;

  for (const date of dates) {
    if (sinceRefit >= refitEvery || model === null) {
      const candidate = fitCalibrationModel(sorted, date, horizonDays);
      if (candidate.samples >= minTrainingSamples) {
        model = candidate;
        sinceRefit = 0;
      }
    }
    if (model && model.samples >= minTrainingSamples) {
      for (const sample of byDate.get(date) ?? []) {
        scored.push({
          p: calibratedProbability(model, sample.score),
          y: sample.outcome,
          base: model.baseRate,
          sample,
        });
      }
      sinceRefit += 1;
    }
  }

  const reliability = emptyBins();
  if (scored.length === 0) {
    return {
      predictions: 0,
      evaluationStart: null,
      evaluationEnd: null,
      brierScore: null,
      baselineBrierScore: null,
      brierSkillScore: null,
      logLoss: null,
      directionalHitRate: null,
      directionalCalls: 0,
      buyHitRate: null,
      sellHitRate: null,
      reliability,
    };
  }

  const brier = mean(scored.map(({ p, y }) => (p - y) ** 2));
  const baseline = mean(scored.map(({ base, y }) => (base - y) ** 2));
  const logLoss = mean(scored.map(({ p, y }) => -(y * Math.log(p) + (1 - y) * Math.log(1 - p))));

  let buyCalls = 0;
  let buyHits = 0;
  let sellCalls = 0;
  let sellHits = 0;
  for (const { sample } of scored) {
    if (sample.signal === "BUY") {
      buyCalls += 1;
      if (sample.outcome === 1) buyHits += 1;
    } else if (sample.signal === "SELL") {
      sellCalls += 1;
      if (sample.outcome === 0) sellHits += 1;
    }
  }

  const binAccumulators = reliability.map(() => ({ predicted: 0, observed: 0, count: 0 }));
  for (const { p, y } of scored) {
    const index = RELIABILITY_EDGES.findIndex(
      (edge, i) =>
        i < RELIABILITY_EDGES.length - 1 && p >= edge && p < (RELIABILITY_EDGES[i + 1] as number),
    );
    const accumulator = binAccumulators[index === -1 ? binAccumulators.length - 1 : index];
    if (!accumulator) continue;
    accumulator.predicted += p;
    accumulator.observed += y;
    accumulator.count += 1;
  }
  binAccumulators.forEach((accumulator, i) => {
    const bin = reliability[i];
    if (!bin || accumulator.count === 0) return;
    bin.count = accumulator.count;
    bin.meanPredicted = round(accumulator.predicted / accumulator.count, 4);
    bin.observedFrequency = round(accumulator.observed / accumulator.count, 4);
  });

  const directionalCalls = buyCalls + sellCalls;
  return {
    predictions: scored.length,
    evaluationStart: scored[0]?.sample.date ?? null,
    evaluationEnd: scored[scored.length - 1]?.sample.date ?? null,
    brierScore: round(brier, 5),
    baselineBrierScore: round(baseline, 5),
    brierSkillScore: baseline > 0 ? round(1 - brier / baseline, 4) : null,
    logLoss: round(logLoss, 5),
    directionalHitRate:
      directionalCalls > 0 ? round((buyHits + sellHits) / directionalCalls, 4) : null,
    directionalCalls,
    buyHitRate: buyCalls > 0 ? round(buyHits / buyCalls, 4) : null,
    sellHitRate: sellCalls > 0 ? round(sellHits / sellCalls, 4) : null,
    reliability,
  };
}
