import { rateOfChange, sma } from "@/lib/markets/indicators";
import { buildFeatureRows, SIGNAL_THRESHOLDS } from "@/lib/markets/signal-engine";
import type { PriceBar } from "@/lib/markets/types";

/**
 * Backtest strategies. Each maps a bar history to a target exposure per bar (1 = long,
 * 0 = flat) decided AT THE CLOSE of that bar using only bars[0..t]. The engine executes the
 * decision at the NEXT bar's open, so no strategy can trade on information it did not have.
 */

export type StrategyId = "sma_crossover" | "momentum" | "composite";

export interface StrategyDefinition {
  id: StrategyId;
  name: string;
  description: string;
  rules: string[];
  parameters: Record<string, number>;
  /** Bars required before the first non-flat decision is possible. */
  warmupBars: number;
  targets: (bars: readonly PriceBar[]) => (0 | 1)[];
}

const smaCrossover: StrategyDefinition = {
  id: "sma_crossover",
  name: "SMA crossover (20/50)",
  description: "Classic trend-following: long while the 20-day average is above the 50-day.",
  rules: ["Enter long when SMA(20) > SMA(50)", "Exit to cash when SMA(20) ≤ SMA(50)"],
  parameters: { fast: 20, slow: 50 },
  warmupBars: 50,
  targets: (bars) => {
    const closes = bars.map((bar) => bar.close);
    const fast = sma(closes, 20);
    const slow = sma(closes, 50);
    return closes.map((_, i) => {
      const f = fast[i];
      const s = slow[i];
      return f !== null && f !== undefined && s !== null && s !== undefined && f > s ? 1 : 0;
    });
  },
};

const momentum: StrategyDefinition = {
  id: "momentum",
  name: "Time-series momentum (3M)",
  description:
    "Long while the trailing three-month return is positive and price is above its 50-day average.",
  rules: [
    "Enter long when 63-day return > 0 and close > SMA(50)",
    "Exit to cash when either condition fails",
  ],
  parameters: { lookback: 63, trendFilter: 50 },
  warmupBars: 63,
  targets: (bars) => {
    const closes = bars.map((bar) => bar.close);
    const roc = rateOfChange(closes, 63);
    const trend = sma(closes, 50);
    return closes.map((close, i) => {
      const r = roc[i];
      const t = trend[i];
      return r !== null && r !== undefined && t !== null && t !== undefined && r > 0 && close > t
        ? 1
        : 0;
    });
  },
};

const composite: StrategyDefinition = {
  id: "composite",
  name: "Composite Esocity signal",
  description:
    "Trades the platform's composite signal with hysteresis: enter on BUY, exit on SELL, keep the current position on HOLD.",
  rules: [
    `Enter long when composite score ≥ ${SIGNAL_THRESHOLDS.buy}`,
    `Exit to cash when composite score ≤ ${SIGNAL_THRESHOLDS.sell}`,
    "HOLD keeps the existing position",
  ],
  parameters: { buyThreshold: SIGNAL_THRESHOLDS.buy, sellThreshold: SIGNAL_THRESHOLDS.sell },
  warmupBars: 80,
  targets: (bars) => {
    const rows = buildFeatureRows(bars);
    let position: 0 | 1 = 0;
    return rows.map((row) => {
      if (row.signal === "BUY") position = 1;
      else if (row.signal === "SELL") position = 0;
      return position;
    });
  },
};

export const STRATEGIES: Record<StrategyId, StrategyDefinition> = {
  sma_crossover: smaCrossover,
  momentum,
  composite,
};

export const STRATEGY_IDS = Object.keys(STRATEGIES) as StrategyId[];
