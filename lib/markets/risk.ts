import { formatPercent } from "@/lib/format";
import type { AssetRisk, FeatureRow, PriceBar } from "@/lib/markets/types";
import { clamp, maxDrawdown } from "@/lib/quant/stats";
import { riskLevelFromScore } from "@/lib/risk-levels";

/**
 * Asset risk score (0–100), transparent by construction:
 *   45% × min(20-day annualised volatility / 60%, 1)
 * + 35% × min(|one-year max drawdown| / 50%, 1)
 * + 20% × volatility percentile within its one-year range
 * Levels: <25 Low · 25–49 Moderate · 50–74 High · ≥75 Very high.
 */
export const ASSET_RISK_WEIGHTS = { volatility: 0.45, drawdown: 0.35, percentile: 0.2 } as const;

export function computeAssetRisk(row: FeatureRow, bars: readonly PriceBar[]): AssetRisk {
  const volatility = row.volatility20 ?? 0;
  const lookback = bars.slice(Math.max(0, row.index - 251), row.index + 1).map((bar) => bar.close);
  const drawdown = maxDrawdown(lookback);
  const percentile = row.volatilityPercentile ?? 0.5;

  const volatilityPart = ASSET_RISK_WEIGHTS.volatility * clamp(volatility / 0.6, 0, 1);
  const drawdownPart = ASSET_RISK_WEIGHTS.drawdown * clamp(Math.abs(drawdown) / 0.5, 0, 1);
  const percentilePart = ASSET_RISK_WEIGHTS.percentile * clamp(percentile, 0, 1);
  const score = Math.round(100 * (volatilityPart + drawdownPart + percentilePart));

  return {
    score,
    level: riskLevelFromScore(score),
    drivers: [
      {
        label: "Volatility (20D, annualised)",
        value: formatPercent(volatility, 1),
        contribution: Math.round(100 * volatilityPart),
      },
      {
        label: "Max drawdown (1Y)",
        value: formatPercent(drawdown, 1),
        contribution: Math.round(100 * drawdownPart),
      },
      {
        label: "Volatility percentile (1Y)",
        value: formatPercent(percentile, 0),
        contribution: Math.round(100 * percentilePart),
      },
    ],
  };
}
