import { SIGNAL_MODEL_VERSION } from "@/lib/markets/signal-engine";
import { FOOTBALL_MODEL_VERSION } from "@/lib/sports/football-model";

/**
 * Model registry — the model cards shown in Model Lab and persisted to `model_versions`.
 * Metadata is static; evaluation metrics are computed live from the engines (see
 * features/model-lab/queries.ts) so the numbers users see are always reproducible.
 */

export type ModelDomain = "markets" | "sports";
export type ModelStatus = "production" | "staging" | "development" | "retired";

export interface ModelCard {
  key: string;
  name: string;
  domain: ModelDomain;
  version: string;
  status: ModelStatus;
  summary: string;
  method: string;
  featureGroups: string[];
  outputs: string[];
  trainingData: string;
  evaluation: string;
  intendedUse: string[];
  limitations: string[];
  uncertainty: string;
  nonGuarantee: string;
  /** Where the model runs. */
  runtime: "typescript" | "python-ml-api";
}

const MARKETS_NON_GUARANTEE =
  "Signals describe historical statistical tendencies. They are not forecasts of certain outcomes, not personalised advice, and must not be the sole basis for any financial decision.";
const SPORTS_NON_GUARANTEE =
  "Probabilities are model estimates with substantial uncertainty. They do not predict certain results and are provided for analysis only — not for wagering.";

export const MODEL_CARDS: ModelCard[] = [
  {
    key: "markets.composite-signal",
    name: "Composite market signal",
    domain: "markets",
    version: SIGNAL_MODEL_VERSION,
    status: "production",
    summary:
      "Weighted blend of trend, momentum, RSI, volatility and regime components producing BUY / HOLD / SELL with conviction and a calibrated 20-day P(up).",
    method:
      "Five bounded component scores (−1…+1) combined with published weights (30/25/15/10/20). Score → P(up) via ridge-penalised logistic calibration fitted walk-forward on the pooled universe.",
    featureGroups: [
      "Trend (SMA 20/50, OLS trend strength)",
      "Momentum (1M/3M, vol-adjusted)",
      "Oscillators (RSI 14)",
      "Volatility (20D, 1Y percentile)",
      "Regime",
    ],
    outputs: [
      "Signal (BUY/HOLD/SELL)",
      "Composite score",
      "Confidence",
      "P(up, 20d)",
      "Expected move (1σ)",
    ],
    trainingData:
      "Daily OHLCV for the demo universe since 2022 (synthetic). Calibration uses only samples whose 20-day outcome was known before each prediction date.",
    evaluation:
      "Expanding-window walk-forward: refit every 63 trading days; Brier score vs climatology, directional hit rate of BUY/SELL calls, reliability diagram.",
    intendedUse: [
      "Research triage: which assets merit deeper analysis",
      "Education on how technical evidence is combined",
      "Input to paper-trading and backtesting experiments",
    ],
    limitations: [
      "Technical inputs only — no fundamentals, news, flows or macro data",
      "Evaluated on synthetic demo prices; real-market skill is unproven",
      "Overlapping 20-day windows make samples highly dependent; effective sample size is small",
      "Regime shifts can invalidate historical relationships quickly",
    ],
    uncertainty:
      "Calibrated probabilities stay close to the base rate by design; conviction is capped at 95% and reduced in high-volatility regimes.",
    nonGuarantee: MARKETS_NON_GUARANTEE,
    runtime: "typescript",
  },
  {
    key: "markets.regime-classifier",
    name: "Market regime classifier",
    domain: "markets",
    version: "1.1.0",
    status: "production",
    summary: "Rule-based classification into Uptrend, Downtrend, Range-bound or High volatility.",
    method:
      "Ordered rules on price vs SMA 50, SMA 20/50 alignment, trend strength (±0.15) and 20-day volatility percentile (≥ 90th → high volatility).",
    featureGroups: ["Moving averages", "Trend strength", "Volatility percentile"],
    outputs: ["Regime label"],
    trainingData: "No fitted parameters; thresholds set a priori and published.",
    evaluation: "Descriptive: regime frequencies and average persistence across the universe.",
    intendedUse: ["Contextualising signals", "Conditioning risk decisions on market state"],
    limitations: [
      "Lagging by construction (moving averages)",
      "Hard thresholds can flip near boundaries",
    ],
    uncertainty: "Labels near thresholds are unstable; the component score it feeds is bounded.",
    nonGuarantee: MARKETS_NON_GUARANTEE,
    runtime: "typescript",
  },
  {
    key: "sports.poisson-dixon-coles",
    name: "Football score model",
    domain: "sports",
    version: FOOTBALL_MODEL_VERSION,
    status: "production",
    summary:
      "Poisson goal model with Dixon–Coles low-score correction producing 1X2, goals markets, BTTS, clean sheets and scoreline probabilities.",
    method:
      "λ from league baseline × home advantage × attack/defence ratings (blended with recent xG) × form, availability and rest multipliers; 0–6 score matrix renormalised to sum to 1.",
    featureGroups: [
      "Team strength ratings",
      "Recent xG",
      "Form (last five)",
      "Availability",
      "Rest / fatigue",
      "Home advantage",
    ],
    outputs: [
      "Home / Draw / Away %",
      "Expected goals",
      "Over/Under 1.5 · 2.5 · 3.5",
      "BTTS",
      "Clean sheets",
      "Top scorelines",
    ],
    trainingData:
      "Ratings re-estimated before every round from earlier results only (Gamma–Poisson shrinkage toward pre-season priors). Demo competitions are fictional.",
    evaluation:
      "Out-of-sample on every finished demo match: multi-class Brier score vs typical base rates, log loss, accuracy, reliability.",
    intendedUse: ["Match analysis and previews", "Understanding drivers of expected goals"],
    limitations: [
      "No lineup-level or tactical data",
      "Independent-Poisson structure underestimates some correlated game states",
      "Small samples early in a season lean heavily on priors",
    ],
    uncertainty:
      "Confidence reflects outcome entropy and input completeness; most football matches carry high irreducible uncertainty.",
    nonGuarantee: SPORTS_NON_GUARANTEE,
    runtime: "typescript",
  },
  {
    key: "sports.team-ratings",
    name: "Team strength ratings",
    domain: "sports",
    version: "1.2.0",
    status: "production",
    summary:
      "Multiplicative attack/defence ratings estimated from results with Bayesian shrinkage.",
    method:
      "Iterative proportional fitting of a Maher Poisson model with Gamma–Poisson priors (6 pseudo-matches) and a strong home-advantage prior.",
    featureGroups: ["Goals for/against", "Opponent strength", "Venue"],
    outputs: ["Attack rating", "Defence rating", "League baseline", "Home advantage"],
    trainingData: "Finished matches before the round being predicted.",
    evaluation: "Indirect — through the score model's out-of-sample accuracy.",
    intendedUse: ["Inputs to the football score model", "Team comparison"],
    limitations: [
      "Ignores squad changes until results reflect them",
      "Priors dominate for newly promoted sides",
    ],
    uncertainty: "Early-season ratings carry wide implicit intervals.",
    nonGuarantee: SPORTS_NON_GUARANTEE,
    runtime: "typescript",
  },
  {
    key: "ml.gbm-direction",
    name: "Gradient-boosted direction classifier",
    domain: "markets",
    version: "0.1.0",
    status: "development",
    summary:
      "Experimental supplementary model in the Python ML service: gradient-boosted trees (XGBoost when installed, scikit-learn otherwise) estimating P(up, 20d).",
    method:
      "Engineered technical features; trained per request on the asset's own history with time-ordered cross-validation; no look-ahead.",
    featureGroups: [
      "Returns (1/5/21/63d)",
      "Volatility",
      "RSI",
      "MACD",
      "Distance to moving averages",
    ],
    outputs: ["P(up, 20d)", "Cross-validated AUC", "Feature importance"],
    trainingData:
      "Bars supplied by the caller; trained walk-forward on data before the prediction date.",
    evaluation: "Time-series cross-validation AUC reported with each prediction.",
    intendedUse: ["Research comparison against the composite signal"],
    limitations: ["Experimental — not used for signals", "Prone to overfitting on short histories"],
    uncertainty: "Reported alongside its cross-validation spread; treat as exploratory.",
    nonGuarantee: MARKETS_NON_GUARANTEE,
    runtime: "python-ml-api",
  },
];

export function findModelCard(key: string): ModelCard | undefined {
  return MODEL_CARDS.find((card) => card.key === key);
}
