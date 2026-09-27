import { formatPercent, formatSignedNumber, formatSignedPercent } from "@/lib/format";
import {
  drawdownSeries,
  ema,
  macd,
  rateOfChange,
  rollingPercentileRank,
  rollingVolatility,
  rsi,
  simpleReturns,
  sma,
  trendStrength,
} from "@/lib/markets/indicators";
import { classifyRegime } from "@/lib/markets/regime";
import {
  REGIME_LABELS,
  type ComponentScores,
  type CompositeSignal,
  type ExpectedDirection,
  type FeatureRow,
  type MarketRegime,
  type PriceBar,
  type SignalComponent,
  type SignalComponentKey,
  type TradeSignal,
} from "@/lib/markets/types";
import { clamp, round } from "@/lib/quant/stats";

/**
 * Esocity composite market signal (model key: markets.composite-signal).
 *
 *   score = Σ weight_k × component_k,   each component ∈ [−1, 1]
 *   BUY  if score ≥ +0.25
 *   SELL if score ≤ −0.25
 *   HOLD otherwise
 *
 * Components: trend (30%), momentum (25%), RSI (15%), volatility (10%), regime (20%).
 * Every formula below is published in docs/MARKETS_ENGINE.md and shown in the UI.
 */

export const SIGNAL_MODEL_VERSION = "1.3.0";
export const SIGNAL_HORIZON_DAYS = 20;

export const SIGNAL_WEIGHTS: Record<SignalComponentKey, number> = {
  trend: 0.3,
  momentum: 0.25,
  rsi: 0.15,
  volatility: 0.1,
  regime: 0.2,
};

export const SIGNAL_THRESHOLDS = { buy: 0.25, sell: -0.25 } as const;

export const COMPONENT_LABELS: Record<SignalComponentKey, string> = {
  trend: "Trend",
  momentum: "Momentum",
  rsi: "RSI (14)",
  volatility: "Volatility",
  regime: "Regime",
};

export const REGIME_SCORES: Record<MarketRegime, number> = {
  UPTREND: 0.8,
  DOWNTREND: -0.8,
  RANGE_BOUND: 0,
  HIGH_VOLATILITY: -0.5,
};

// ─── Component scoring (pure) ────────────────────────────────────────────────────────────────

/** 60% regression trend strength + 40% moving-average alignment. */
export function scoreTrend(close: number, sma20: number, sma50: number, strength: number): number {
  const alignment =
    (Math.sign(close - sma20) + Math.sign(sma20 - sma50) + Math.sign(close - sma50)) / 3;
  return clamp(0.6 * strength + 0.4 * alignment, -1, 1);
}

/** Volatility-adjusted 3-month (70%) and 1-month (30%) momentum, squashed with tanh. */
export function scoreMomentum(
  momentum21: number,
  momentum63: number,
  volatility63: number,
): number {
  const vol = Math.max(volatility63, 0.05);
  const z63 = momentum63 / (vol * Math.sqrt(63 / 252));
  const z21 = momentum21 / (vol * Math.sqrt(21 / 252));
  return Math.tanh((0.7 * z63 + 0.3 * z21) / 1.5);
}

/**
 * RSI: mild momentum confirmation inside 30–70, reversing beyond the bands to reflect
 * mean-reversion risk (overbought → negative, oversold → positive). Continuous and bounded.
 */
export function scoreRsi(value: number): number {
  const confirmation = (0.5 * (value - 50)) / 50;
  const overbought = (1.5 * Math.max(0, value - 70)) / 30;
  const oversold = (1.5 * Math.max(0, 30 - value)) / 30;
  return clamp(confirmation - overbought + oversold, -1, 1);
}

/** Calm volatility adds up to +0.5; volatility above its one-year median subtracts up to −1. */
export function scoreVolatility(percentile: number): number {
  const p = clamp(percentile, 0, 1);
  return p <= 0.5 ? 0.5 - p : -2 * (p - 0.5);
}

export function scoreRegime(regime: MarketRegime): number {
  return REGIME_SCORES[regime];
}

export function compositeScore(scores: ComponentScores): number {
  let total = 0;
  for (const key of Object.keys(SIGNAL_WEIGHTS) as SignalComponentKey[]) {
    total += SIGNAL_WEIGHTS[key] * scores[key];
  }
  return clamp(total, -1, 1);
}

export function decideSignal(score: number): TradeSignal {
  if (score >= SIGNAL_THRESHOLDS.buy) return "BUY";
  if (score <= SIGNAL_THRESHOLDS.sell) return "SELL";
  return "HOLD";
}

/**
 * Conviction in [0.05, 0.95]:
 *   decisiveness — distance of the score beyond the decision threshold (BUY/SELL), mapped to
 *                  [0.5, 1], or inside the neutral band (HOLD), mapped to [0.5, 0.8] — a HOLD
 *                  reflects absence of evidence, so it never earns top-tier conviction;
 *   agreement    — weighted share of components that support the call;
 *   confidence   = decisiveness × (0.55 + 0.45 × agreement), × 0.85 in high-volatility regimes.
 * Capped at 95%: the model never claims certainty.
 */
export function computeConfidence(
  score: number,
  signal: TradeSignal,
  scores: ComponentScores,
  regime: MarketRegime,
): number {
  const threshold = SIGNAL_THRESHOLDS.buy;
  const magnitude = Math.abs(score);
  const decisiveness =
    signal === "HOLD"
      ? 0.5 + 0.3 * Math.pow(clamp((threshold - magnitude) / threshold, 0, 1), 0.7)
      : 0.5 + 0.5 * Math.pow(clamp((magnitude - threshold) / 0.5, 0, 1), 0.7);

  let supportingWeight = 0;
  let totalWeight = 0;
  for (const key of Object.keys(SIGNAL_WEIGHTS) as SignalComponentKey[]) {
    const weight = SIGNAL_WEIGHTS[key];
    const componentScore = scores[key];
    totalWeight += weight;
    const supports =
      signal === "HOLD"
        ? Math.abs(componentScore) < 0.35
        : componentScore * Math.sign(score) > 0.05;
    if (supports) supportingWeight += weight;
  }
  const agreement = supportingWeight / totalWeight;
  const volatilityPenalty = regime === "HIGH_VOLATILITY" ? 0.85 : 1;
  return clamp(round(decisiveness * (0.55 + 0.45 * agreement) * volatilityPenalty, 3), 0.05, 0.95);
}

export function expectedDirectionFromProbability(probabilityUp: number): ExpectedDirection {
  if (probabilityUp >= 0.55) return "UP";
  if (probabilityUp <= 0.45) return "DOWN";
  return "SIDEWAYS";
}

// ─── Feature rows ────────────────────────────────────────────────────────────────────────────

function valueAt(series: (number | null)[], index: number): number | null {
  const value = series[index];
  return value === undefined ? null : value;
}

/**
 * Compute every feature for every bar. Each row uses only bars[0..index] (causal), so the
 * composite score at bar t is exactly what the model would have produced on day t.
 */
export function buildFeatureRows(bars: readonly PriceBar[]): FeatureRow[] {
  const closes = bars.map((bar) => bar.close);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const ema20 = ema(closes, 20);
  const rsi14 = rsi(closes, 14);
  const macdSeries = macd(closes);
  const momentum21 = rateOfChange(closes, 21);
  const momentum63 = rateOfChange(closes, 63);
  const volatility20 = rollingVolatility(closes, 20);
  const volatility63 = rollingVolatility(closes, 63);
  const volatilityPercentile = rollingPercentileRank(volatility20, 252, 60);
  const strength = trendStrength(closes, 50);
  const drawdown = drawdownSeries(closes);
  const returns = simpleReturns(closes);

  return bars.map((bar, i) => {
    const row: FeatureRow = {
      index: i,
      date: bar.date,
      close: bar.close,
      volume: bar.volume,
      return1d: valueAt(returns, i),
      sma20: valueAt(sma20, i),
      sma50: valueAt(sma50, i),
      ema20: valueAt(ema20, i),
      rsi14: valueAt(rsi14, i),
      macd: valueAt(macdSeries.macd, i),
      macdSignal: valueAt(macdSeries.signal, i),
      macdHistogram: valueAt(macdSeries.histogram, i),
      momentum21: valueAt(momentum21, i),
      momentum63: valueAt(momentum63, i),
      volatility20: valueAt(volatility20, i),
      volatility63: valueAt(volatility63, i),
      volatilityPercentile: valueAt(volatilityPercentile, i),
      trendStrength: valueAt(strength, i),
      drawdown: drawdown[i] ?? 0,
      regime: null,
      scores: null,
      composite: null,
      signal: null,
    };

    if (
      row.sma20 !== null &&
      row.sma50 !== null &&
      row.rsi14 !== null &&
      row.momentum21 !== null &&
      row.momentum63 !== null &&
      row.volatility63 !== null &&
      row.volatilityPercentile !== null &&
      row.trendStrength !== null
    ) {
      const regime = classifyRegime({
        close: row.close,
        sma20: row.sma20,
        sma50: row.sma50,
        trendStrength: row.trendStrength,
        volatilityPercentile: row.volatilityPercentile,
      });
      const scores: ComponentScores = {
        trend: scoreTrend(row.close, row.sma20, row.sma50, row.trendStrength),
        momentum: scoreMomentum(row.momentum21, row.momentum63, row.volatility63),
        rsi: scoreRsi(row.rsi14),
        volatility: scoreVolatility(row.volatilityPercentile),
        regime: scoreRegime(regime),
      };
      const composite = compositeScore(scores);
      row.regime = regime;
      row.scores = scores;
      row.composite = composite;
      row.signal = decideSignal(composite);
    }
    return row;
  });
}

/** Composite score series (null during warm-up), aligned with bars. */
export function compositeScoreSeries(bars: readonly PriceBar[]): (number | null)[] {
  return buildFeatureRows(bars).map((row) => row.composite);
}

// ─── Presentation: components + explanation ──────────────────────────────────────────────────

function ordinal(value: number): string {
  const n = Math.round(value);
  const suffix =
    n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
  return `${n}${suffix}`;
}

function interpretComponent(key: SignalComponentKey, row: FeatureRow, score: number): string {
  switch (key) {
    case "trend":
      if (score > 0.3) return "Established uptrend";
      if (score < -0.3) return "Established downtrend";
      return "No clear trend";
    case "momentum":
      if (score > 0.3) return "Positive risk-adjusted momentum";
      if (score < -0.3) return "Negative risk-adjusted momentum";
      return "Momentum broadly flat";
    case "rsi": {
      const value = row.rsi14 ?? 50;
      if (value >= 70) return "Overbought — mean-reversion risk";
      if (value <= 30) return "Oversold — rebound potential";
      if (value >= 55) return "Bullish, not stretched";
      if (value <= 45) return "Bearish, not stretched";
      return "Neutral";
    }
    case "volatility": {
      const p = row.volatilityPercentile ?? 0.5;
      if (p >= 0.8) return "Elevated vs. one-year range — lowers conviction";
      if (p <= 0.3) return "Calm vs. one-year range";
      return "Within normal range";
    }
    case "regime":
      switch (row.regime) {
        case "UPTREND":
          return "Trend-following conditions";
        case "DOWNTREND":
          return "Defensive conditions";
        case "HIGH_VOLATILITY":
          return "Stressed conditions — risk-off tilt";
        default:
          return "Sideways conditions";
      }
  }
}

function describeComponentValue(key: SignalComponentKey, row: FeatureRow): string {
  switch (key) {
    case "trend": {
      const distance = row.sma50 ? row.close / row.sma50 - 1 : 0;
      const cross = (row.sma20 ?? 0) > (row.sma50 ?? 0) ? "20D > 50D" : "20D < 50D";
      return `${formatSignedPercent(distance, 1)} vs 50D · ${cross} · strength ${formatSignedNumber(row.trendStrength ?? 0, 2)}`;
    }
    case "momentum":
      return `3M ${formatSignedPercent(row.momentum63 ?? 0, 1)} · 1M ${formatSignedPercent(row.momentum21 ?? 0, 1)}`;
    case "rsi":
      return `RSI ${(row.rsi14 ?? 50).toFixed(1)}`;
    case "volatility":
      return `20D ${formatPercent(row.volatility20 ?? 0, 1)} ann. · ${ordinal((row.volatilityPercentile ?? 0) * 100)} pct`;
    case "regime":
      return row.regime ? REGIME_LABELS[row.regime] : "—";
  }
}

export function buildSignalComponents(row: FeatureRow): SignalComponent[] {
  if (!row.scores) return [];
  const scores = row.scores;
  return (Object.keys(SIGNAL_WEIGHTS) as SignalComponentKey[]).map((key) => ({
    key,
    label: COMPONENT_LABELS[key],
    weight: SIGNAL_WEIGHTS[key],
    score: round(scores[key], 4),
    contribution: round(SIGNAL_WEIGHTS[key] * scores[key], 4),
    value: describeComponentValue(key, row),
    interpretation: interpretComponent(key, row, scores[key]),
  }));
}

export function explainSignal(
  symbol: string,
  row: FeatureRow,
  signal: TradeSignal,
  confidence: number,
  probabilityUp: number,
): string {
  const parts: string[] = [];
  const score = row.composite ?? 0;
  parts.push(
    `${symbol} screens ${signal} with a composite score of ${formatSignedNumber(score, 2)} and ${formatPercent(confidence, 0)} confidence.`,
  );

  if (row.sma50 !== null && row.sma20 !== null) {
    const distance = row.close / row.sma50 - 1;
    const trendScore = row.scores?.trend ?? 0;
    const trendPhrase =
      trendScore > 0.3 ? "constructive" : trendScore < -0.3 ? "negative" : "indecisive";
    parts.push(
      `The trend is ${trendPhrase}: price is ${formatPercent(Math.abs(distance), 1)} ${distance >= 0 ? "above" : "below"} its 50-day average and the 20-day average is ${row.sma20 >= row.sma50 ? "above" : "below"} the 50-day.`,
    );
  }
  if (row.momentum63 !== null) {
    parts.push(`Three-month momentum is ${formatSignedPercent(row.momentum63, 1)}.`);
  }
  if (row.rsi14 !== null) {
    const rsiPhrase =
      row.rsi14 >= 70
        ? "overbought, which tempers the signal"
        : row.rsi14 <= 30
          ? "oversold, which raises rebound risk for short positioning"
          : "within its neutral band";
    parts.push(`RSI(14) at ${row.rsi14.toFixed(0)} is ${rsiPhrase}.`);
  }
  if (row.volatilityPercentile !== null) {
    const elevated = row.volatilityPercentile >= 0.8;
    parts.push(
      `Volatility sits in the ${ordinal(row.volatilityPercentile * 100)} percentile of its one-year range${elevated ? ", reducing conviction" : ""}.`,
    );
  }
  parts.push(
    `Historically calibrated probability of a positive ${SIGNAL_HORIZON_DAYS}-day return: ${formatPercent(probabilityUp, 0)}.`,
  );
  return parts.join(" ");
}

export interface SignalContext {
  symbol: string;
  probabilityUp: number;
  horizonDays?: number;
}

/** Assemble the full, explainable signal for a feature row (typically the latest bar). */
export function buildCompositeSignal(row: FeatureRow, context: SignalContext): CompositeSignal {
  if (row.composite === null || !row.scores || !row.regime) {
    throw new Error(`Insufficient history to compute a signal for ${context.symbol}`);
  }
  const horizonDays = context.horizonDays ?? SIGNAL_HORIZON_DAYS;
  const signal = decideSignal(row.composite);
  const confidence = computeConfidence(row.composite, signal, row.scores, row.regime);
  const volatility = row.volatility20 ?? row.volatility63 ?? 0;
  return {
    signal,
    score: round(row.composite, 4),
    confidence,
    probabilityUp: round(context.probabilityUp, 4),
    expectedDirection: expectedDirectionFromProbability(context.probabilityUp),
    expectedMove: round(volatility * Math.sqrt(horizonDays / 252), 4),
    horizonDays,
    regime: row.regime,
    components: buildSignalComponents(row),
    explanation: explainSignal(context.symbol, row, signal, confidence, context.probabilityUp),
    thresholds: { ...SIGNAL_THRESHOLDS },
    asOf: row.date,
  };
}
