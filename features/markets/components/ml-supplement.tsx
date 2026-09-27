import { BrainCircuit } from "lucide-react";

import { EmptyState } from "@/components/data/empty-state";
import { ProbabilityMeter } from "@/components/indicators/meters";
import type { EngineInfo, MarketSupplement } from "@/lib/ml/engine";

/** Supplementary gradient-boosting view from the optional Python ML service. */
export function MlSupplementPanel({
  supplement,
  engine,
}: {
  supplement: MarketSupplement | null;
  engine: EngineInfo;
}) {
  if (!supplement) {
    return (
      <EmptyState
        icon={BrainCircuit}
        title="ML service not connected"
        description={
          engine.fallbackReason
            ? `The Python ML service was configured but unavailable (${engine.fallbackReason}). Signals above come from the built-in engine.`
            : "Set ML_API_URL to add an experimental gradient-boosted P(up) from the Python service. The platform runs fully without it."
        }
      />
    );
  }
  return (
    <div className="space-y-4">
      <ProbabilityMeter
        label="ML P(up, 20d)"
        hint={`(${supplement.engine})`}
        value={supplement.probabilityUp}
        emphasis
      />
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Cross-validated AUC</dt>
          <dd className="num font-semibold">
            {supplement.cvAuc === null ? "—" : supplement.cvAuc.toFixed(3)}
            {supplement.cvAucStd ? (
              <span className="text-xs text-muted-foreground">
                {" "}
                ± {supplement.cvAucStd.toFixed(3)}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Training samples</dt>
          <dd className="num font-semibold">
            {supplement.trainingSamples.toLocaleString("en-US")}
          </dd>
        </div>
      </dl>
      {supplement.topFeatures.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Top features</p>
          <ul className="space-y-1 text-sm">
            {supplement.topFeatures.slice(0, 5).map((feature) => (
              <li key={feature.name} className="flex justify-between gap-2">
                <span className="font-mono text-xs">{feature.name}</span>
                <span className="num text-xs text-muted-foreground">
                  {feature.importance.toFixed(3)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Experimental research model (AUC ≈ 0.5 means no better than chance). Not used to generate
        the platform signal.
      </p>
    </div>
  );
}
