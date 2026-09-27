/**
 * Shared four-level scale used for portfolio risk, asset risk and prediction uncertainty.
 * Thresholds are applied to 0–100 scores and are intentionally simple and published.
 */

export const RISK_LEVELS = ["LOW", "MODERATE", "HIGH", "VERY_HIGH"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  LOW: "Low",
  MODERATE: "Moderate",
  HIGH: "High",
  VERY_HIGH: "Very high",
};

/** Score thresholds (inclusive lower bounds). */
export const RISK_SCORE_BANDS: { level: RiskLevel; min: number }[] = [
  { level: "VERY_HIGH", min: 75 },
  { level: "HIGH", min: 50 },
  { level: "MODERATE", min: 25 },
  { level: "LOW", min: 0 },
];

export function riskLevelFromScore(score: number): RiskLevel {
  for (const band of RISK_SCORE_BANDS) {
    if (score >= band.min) return band.level;
  }
  return "LOW";
}
