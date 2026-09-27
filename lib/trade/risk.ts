import { formatPercent } from "@/lib/format";
import { clamp } from "@/lib/quant/stats";
import { riskLevelFromScore } from "@/lib/risk-levels";
import type { PortfolioRisk, PortfolioSummary, RiskFactor } from "@/lib/trade/types";

/**
 * Portfolio risk engine. Four transparent factors, each scored linearly between a published
 * floor and cap, summed to a 0–100 score:
 *
 *   Volatility     35 pts   8% → 40% annualised (ex-ante, current holdings)
 *   Drawdown       25 pts   0% → 25% maximum drawdown (simulated history)
 *   Concentration  25 pts  10% → 50% largest single-position weight
 *   Exposure       15 pts  50% → 100% of value invested (vs. cash)
 *
 * Levels: <25 Low · 25–49 Moderate · 50–74 High · ≥75 Very high.
 */

interface FactorSpec {
  key: RiskFactor["key"];
  label: string;
  floor: number;
  cap: number;
  maxPoints: number;
}

export const RISK_FACTOR_SPECS: FactorSpec[] = [
  {
    key: "volatility",
    label: "Volatility (ex-ante, annualised)",
    floor: 0.08,
    cap: 0.4,
    maxPoints: 35,
  },
  { key: "drawdown", label: "Maximum drawdown (simulated)", floor: 0, cap: 0.25, maxPoints: 25 },
  { key: "concentration", label: "Largest position weight", floor: 0.1, cap: 0.5, maxPoints: 25 },
  { key: "exposure", label: "Gross exposure", floor: 0.5, cap: 1, maxPoints: 15 },
];

function points(value: number, spec: FactorSpec): number {
  const scaled = clamp((value - spec.floor) / (spec.cap - spec.floor), 0, 1);
  return Math.round(scaled * spec.maxPoints * 10) / 10;
}

export function assessPortfolioRisk(input: {
  summary: PortfolioSummary;
  volatility: number;
  maxDrawdown: number;
}): PortfolioRisk {
  const concentration = input.summary.largestPosition?.weight ?? 0;
  const values: Record<RiskFactor["key"], number> = {
    volatility: input.volatility,
    drawdown: Math.abs(input.maxDrawdown),
    concentration,
    exposure: input.summary.grossExposure,
  };

  const factors: RiskFactor[] = RISK_FACTOR_SPECS.map((spec) => ({
    key: spec.key,
    label: spec.label,
    value: values[spec.key],
    display: formatPercent(values[spec.key], 1),
    points: points(values[spec.key], spec),
    maxPoints: spec.maxPoints,
    threshold: `${formatPercent(spec.floor, 0)} → ${formatPercent(spec.cap, 0)}`,
  }));
  const score = Math.round(factors.reduce((total, factor) => total + factor.points, 0));

  const warnings: string[] = [];
  if (concentration > 0.35 && input.summary.largestPosition) {
    warnings.push(
      `${input.summary.largestPosition.symbol} is ${formatPercent(concentration, 0)} of the portfolio.`,
    );
  }
  if (input.volatility > 0.3) {
    warnings.push(`Ex-ante volatility of ${formatPercent(input.volatility, 0)} is elevated.`);
  }
  if (Math.abs(input.maxDrawdown) > 0.15) {
    warnings.push(`Simulated drawdown reached ${formatPercent(input.maxDrawdown, 1)}.`);
  }
  if (input.summary.cashWeight < 0.02) {
    warnings.push("Less than 2% of the portfolio is held in cash.");
  }

  return {
    score,
    level: riskLevelFromScore(score),
    volatility: input.volatility,
    maxDrawdown: input.maxDrawdown,
    concentration,
    grossExposure: input.summary.grossExposure,
    factors,
    warnings,
  };
}
