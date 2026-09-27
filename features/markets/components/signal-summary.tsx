import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import { RegimeBadge, RiskBadge, SignalBadge } from "@/components/indicators/badges";
import { ProbabilityMeter } from "@/components/indicators/meters";
import { formatPercent, formatSignedNumber } from "@/lib/format";
import type { AssetRisk, CompositeSignal } from "@/lib/markets/types";

const DIRECTION = {
  UP: { icon: ArrowUpRight, label: "Up", className: "text-positive" },
  DOWN: { icon: ArrowDownRight, label: "Down", className: "text-negative" },
  SIDEWAYS: { icon: ArrowRight, label: "Sideways", className: "text-muted-foreground" },
} as const;

export function SignalSummary({ signal, risk }: { signal: CompositeSignal; risk: AssetRisk }) {
  const direction = DIRECTION[signal.expectedDirection];
  const DirectionIcon = direction.icon;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <SignalBadge signal={signal.signal} size="lg" />
        <div>
          <p className="text-xs text-muted-foreground">Composite score</p>
          <p className="num text-xl font-semibold">{formatSignedNumber(signal.score, 2)}</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <RegimeBadge regime={signal.regime} />
          <RiskBadge level={risk.level} />
        </div>
      </div>

      <div className="space-y-3">
        <ProbabilityMeter
          label="Signal confidence"
          hint="(conviction)"
          value={signal.confidence}
          emphasis
        />
        <ProbabilityMeter
          label={`P(up, ${signal.horizonDays}d)`}
          hint="(calibrated)"
          value={signal.probabilityUp}
        />
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">Expected direction</dt>
          <dd
            className={`mt-1 inline-flex items-center gap-1 font-semibold ${direction.className}`}
          >
            <DirectionIcon className="size-4" aria-hidden />
            {direction.label}
          </dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">
            Expected move (1σ, {signal.horizonDays}d)
          </dt>
          <dd className="num mt-1 font-semibold">±{formatPercent(signal.expectedMove, 1)}</dd>
        </div>
      </dl>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Thresholds: BUY ≥ {formatSignedNumber(signal.thresholds.buy, 2)}, SELL ≤{" "}
        {formatSignedNumber(signal.thresholds.sell, 2)}. Confidence measures how decisive and
        consistent the evidence is; it is not a probability of profit. P(up) is the historically
        calibrated chance of a positive {signal.horizonDays}-day return.
      </p>
    </div>
  );
}
