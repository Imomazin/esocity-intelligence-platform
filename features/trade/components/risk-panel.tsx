import { TriangleAlert } from "lucide-react";

import { RiskBadge } from "@/components/indicators/badges";
import { formatPercent } from "@/lib/format";
import type { PortfolioRisk } from "@/lib/trade/types";

/** Transparent portfolio risk: score, per-factor points against published thresholds, warnings. */
export function RiskPanel({ risk, compact = false }: { risk: PortfolioRisk; compact?: boolean }) {
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Risk score</p>
          <p className="text-3xl font-semibold">
            {risk.score}
            <span className="text-sm font-normal text-muted-foreground"> / 100</span>
          </p>
        </div>
        <RiskBadge level={risk.level} />
      </div>
      <ul className="space-y-3" aria-label="Risk factors">
        {risk.factors.map((factor) => (
          <li key={factor.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{factor.label}</span>
              <span className="num font-medium">{factor.display}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className="block h-full rounded-full bg-series-1"
                  style={{ width: `${(factor.points / factor.maxPoints) * 100}%` }}
                />
              </span>
              <span className="num w-16 text-right text-[11px] text-muted-foreground">
                {factor.points.toFixed(1)}/{factor.maxPoints} pts
              </span>
            </div>
            {!compact && (
              <p className="text-[11px] text-muted-foreground">
                Scored linearly {factor.threshold}
              </p>
            )}
          </li>
        ))}
      </ul>
      {risk.warnings.length > 0 && (
        <ul className="space-y-1.5 rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-xs">
          {risk.warnings.map((warning) => (
            <li key={warning} className="flex gap-1.5">
              <TriangleAlert
                className="mt-0.5 size-3.5 shrink-0 text-status-warning-text"
                aria-hidden
              />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}
      {!compact && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Levels: below 25 low · 25–49 moderate · 50–74 high · 75+ very high. Volatility is ex-ante
          on current holdings ({formatPercent(risk.volatility, 1)}); drawdown is from the simulated
          account history ({formatPercent(risk.maxDrawdown, 1)}).
        </p>
      )}
    </div>
  );
}
