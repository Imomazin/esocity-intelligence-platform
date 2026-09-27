import type { Metadata } from "next";

import { Disclaimer } from "@/components/data/disclaimer";
import { StatusBadge } from "@/components/indicators/badges";
import { PageHeader } from "@/components/layout/page-header";
import { ModelCardView } from "@/features/model-lab/components/model-card";
import { getModelLabView } from "@/features/model-lab/queries";

export const metadata: Metadata = {
  title: "Model Lab",
  description: "Model cards, evaluation metrics and calibration for every Esocity model.",
};

export const revalidate = 300;

export default async function ModelLabPage() {
  const view = await getModelLabView();
  const markets = view.entries.filter((entry) => entry.card.domain === "markets");
  const sports = view.entries.filter((entry) => entry.card.domain === "sports");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Esocity Core · Research"
        title="Model Lab"
        description="Every model is documented with its intended use, limitations, evaluation method and live out-of-sample metrics. Probabilities are only as useful as their calibration — so calibration is shown, including where it falls short."
        meta={
          <>
            <span>Python ML service:</span>
            <StatusBadge
              status={
                view.mlService.status === "up"
                  ? "up"
                  : view.mlService.configured
                    ? "down"
                    : "not_configured"
              }
              label={
                view.mlService.status === "up"
                  ? `Online${view.mlService.version ? ` · v${view.mlService.version}` : ""}`
                  : view.mlService.configured
                    ? "Unreachable (local engines in use)"
                    : "Not configured (optional)"
              }
            />
          </>
        }
      />

      <nav aria-label="Models" className="flex flex-wrap gap-2 text-xs">
        {view.entries.map((entry) => (
          <a
            key={entry.card.key}
            href={`#${entry.card.key}`}
            className="rounded-md border px-2.5 py-1 hover:bg-muted"
          >
            {entry.card.name}
          </a>
        ))}
      </nav>

      <section aria-labelledby="markets-models" className="space-y-4">
        <h2
          id="markets-models"
          className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
        >
          Markets models
        </h2>
        {markets.map((entry) => (
          <ModelCardView key={entry.card.key} entry={entry} />
        ))}
      </section>

      <section aria-labelledby="sports-models" className="space-y-4">
        <h2
          id="sports-models"
          className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
        >
          Sports models
        </h2>
        {sports.map((entry) => (
          <ModelCardView key={entry.card.key} entry={entry} />
        ))}
      </section>

      <Disclaimer>
        Metrics are computed live on synthetic demo data to demonstrate the evaluation pipeline.
        They are not evidence of performance on real markets or real competitions.
      </Disclaimer>
    </div>
  );
}
