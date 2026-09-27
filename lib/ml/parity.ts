import { DEFAULT_BACKTEST_COSTS, runBacktest } from "@/lib/backtesting/engine";
import { STRATEGY_IDS } from "@/lib/backtesting/strategies";
import { buildFeatureRows, computeConfidence } from "@/lib/markets/signal-engine";
import { generateSyntheticHistory } from "@/lib/markets/synthetic";
import type { PriceBar } from "@/lib/markets/types";
import { toSportsRequest } from "@/lib/ml/engine";
import { predictMatch } from "@/lib/sports/football-model";
import type { MatchModelInputs } from "@/lib/sports/types";

/**
 * Cross-language parity fixtures.
 *
 * The Python ML service (services/ml-api) re-implements the football model, the indicators,
 * the composite signal and the backtester. These fixtures pin the TypeScript outputs for fixed
 * inputs; `services/ml-api/tests/test_parity.py` asserts the Python outputs match, and
 * `tests/unit/parity-fixtures.test.ts` fails if the TypeScript engines change without the
 * fixtures being regenerated (`pnpm parity:fixtures`).
 *
 * Everything here is deterministic: synthetic data is generated through a fixed date.
 */

export const PARITY_FIXTURE_VERSION = 1;
const THROUGH_DATE = "2026-06-30";

const SPORTS_CASES: { name: string; inputs: MatchModelInputs }[] = [
  {
    name: "ratings-only",
    inputs: {
      home: { attack: 1.1, defence: 0.95 },
      away: { attack: 0.92, defence: 1.05 },
      leagueBaselineGoals: 1.38,
      homeAdvantage: 1.25,
    },
  },
  {
    name: "full-context",
    inputs: {
      home: {
        attack: 1.28,
        defence: 0.82,
        form: ["W", "W", "D", "W", "L"],
        xgFor: 1.9,
        xgAgainst: 0.95,
        injuries: "minor",
        restDays: 6,
      },
      away: {
        attack: 0.86,
        defence: 1.18,
        form: ["L", "D", "L", "W", "L"],
        xgFor: 1.05,
        xgAgainst: 1.7,
        injuries: "major",
        restDays: 3,
      },
      leagueBaselineGoals: 1.42,
      homeAdvantage: 1.3,
      rho: -0.08,
    },
  },
  {
    name: "away-favourite-short-rest",
    inputs: {
      home: {
        attack: 0.8,
        defence: 1.25,
        form: ["L", "L", "D"],
        xgFor: 0.9,
        xgAgainst: 1.8,
        restDays: 2,
      },
      away: {
        attack: 1.45,
        defence: 0.75,
        form: ["W", "W", "W", "W", "W"],
        xgFor: 2.3,
        xgAgainst: 0.8,
        restDays: 8,
      },
      leagueBaselineGoals: 1.38,
      homeAdvantage: 1.25,
    },
  },
  {
    name: "even-contest-wide-matrix",
    inputs: {
      home: {
        attack: 1,
        defence: 1,
        form: ["D", "D", "W", "L", "D"],
        injuries: "moderate",
        restDays: 4,
      },
      away: {
        attack: 1,
        defence: 1,
        form: ["D", "W", "L", "D", "D"],
        injuries: "moderate",
        restDays: 4,
      },
      leagueBaselineGoals: 1.2,
      homeAdvantage: 1.1,
      rho: 0.05,
      maxGoals: 8,
    },
  },
  {
    name: "high-scoring",
    inputs: {
      home: { attack: 1.6, defence: 1.3, xgFor: 2.6, xgAgainst: 1.9 },
      away: { attack: 1.5, defence: 1.35, xgFor: 2.4, xgAgainst: 2.0 },
      leagueBaselineGoals: 1.6,
      homeAdvantage: 1.2,
    },
  },
];

function sportsExpectation(inputs: MatchModelInputs) {
  const p = predictMatch(inputs);
  return {
    lambda_home: p.lambdaHome,
    lambda_away: p.lambdaAway,
    max_goals: p.maxGoals,
    rho: p.rho,
    score_matrix: p.scoreMatrix,
    truncated_mass: p.truncatedMass,
    outcome: p.outcome,
    most_likely_outcome: p.mostLikelyOutcome,
    markets: {
      over_15: p.markets.over15,
      over_25: p.markets.over25,
      over_35: p.markets.over35,
      under_15: p.markets.under15,
      under_25: p.markets.under25,
      under_35: p.markets.under35,
      btts_yes: p.markets.bttsYes,
      btts_no: p.markets.bttsNo,
      clean_sheet_home: p.markets.cleanSheetHome,
      clean_sheet_away: p.markets.cleanSheetAway,
    },
    top_scorelines: p.topScorelines,
    outcome_entropy: p.outcomeEntropy,
    data_quality: p.dataQuality,
    confidence: p.confidence,
    uncertainty: p.uncertainty,
    factors: p.factors.map(({ key, home, away }) => ({ key, home, away })),
  };
}

function marketExpectation(bars: readonly PriceBar[]) {
  const rows = buildFeatureRows(bars);
  const last = rows[rows.length - 1];
  if (!last || last.composite === null || !last.scores || !last.regime || !last.signal) {
    throw new Error("Parity market case has insufficient history");
  }
  return {
    latest: {
      date: last.date,
      sma20: last.sma20,
      sma50: last.sma50,
      ema20: last.ema20,
      rsi14: last.rsi14,
      macd: last.macd,
      macd_signal: last.macdSignal,
      macd_histogram: last.macdHistogram,
      momentum21: last.momentum21,
      momentum63: last.momentum63,
      volatility20: last.volatility20,
      volatility63: last.volatility63,
      volatility_percentile: last.volatilityPercentile,
      trend_strength: last.trendStrength,
      drawdown: last.drawdown,
      regime: last.regime,
      scores: last.scores,
      composite: last.composite,
      signal: last.signal,
      confidence: computeConfidence(last.composite, last.signal, last.scores, last.regime),
    },
    // Composite score and signal on the last 60 bars exercise many different states.
    recent: rows
      .slice(-60)
      .map((row) => ({ date: row.date, composite: row.composite, signal: row.signal })),
  };
}

export function buildParityFixtures() {
  const sports = SPORTS_CASES.map(({ name, inputs }) => ({
    name,
    request: toSportsRequest(inputs),
    expected: sportsExpectation(inputs),
  }));

  const markets = ["AAPL", "TSLA"].map((symbol) => {
    const bars = generateSyntheticHistory(symbol, THROUGH_DATE).slice(-420);
    return { name: symbol, symbol, bars, expected: marketExpectation(bars) };
  });

  const backtestBars = generateSyntheticHistory("NVDA", THROUGH_DATE).slice(-520);
  const startDate = (backtestBars[140] as PriceBar).date;
  const endDate = (backtestBars[backtestBars.length - 1] as PriceBar).date;
  const backtests = STRATEGY_IDS.map((strategy) => {
    const config = {
      symbol: "NVDA",
      strategy,
      startDate,
      endDate,
      initialCapital: DEFAULT_BACKTEST_COSTS.initialCapital,
      feeBps: DEFAULT_BACKTEST_COSTS.feeBps,
      slippageBps: DEFAULT_BACKTEST_COSTS.slippageBps,
    };
    const result = runBacktest(backtestBars, config);
    return {
      name: strategy,
      request: {
        symbol: config.symbol,
        strategy: config.strategy,
        start_date: config.startDate,
        end_date: config.endDate,
        initial_capital: config.initialCapital,
        fee_bps: config.feeBps,
        slippage_bps: config.slippageBps,
      },
      expected: {
        metrics: result.metrics,
        trades: result.trades,
        equity_first: result.equityCurve[0],
        equity_last: result.equityCurve[result.equityCurve.length - 1],
        equity_points: result.equityCurve.length,
        warnings: result.warnings.length,
      },
    };
  });

  return {
    version: PARITY_FIXTURE_VERSION,
    generated_by: "scripts/generate-parity-fixtures.ts",
    through_date: THROUGH_DATE,
    sports,
    markets,
    backtest: { bars: backtestBars, cases: backtests },
  };
}

export type ParityFixtures = ReturnType<typeof buildParityFixtures>;

/** Canonical serialisation (compact; the file is machine-generated). */
export function serialiseParityFixtures(fixtures: ParityFixtures): string {
  return `${JSON.stringify(fixtures)}\n`;
}
