import { CalibrationChart } from "@/components/charts/calibration-chart";
import { StatusBadge } from "@/components/indicators/badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { ModelLabEntry } from "@/features/model-lab/queries";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  production: "border-status-good/40 bg-status-good/10",
  staging: "border-status-warning/40 bg-status-warning/10",
  development: "border-border bg-muted",
  retired: "border-border bg-muted",
};

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
      <ul className="list-disc space-y-1 pl-4 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function ModelCardView({ entry }: { entry: ModelLabEntry }) {
  const { card } = entry;
  return (
    <Card id={card.key} className="scroll-mt-20">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono">
            {card.key}
          </Badge>
          <Badge variant="outline">v{card.version}</Badge>
          <Badge variant="outline" className={cn("capitalize", STATUS_STYLE[card.status])}>
            {card.status}
          </Badge>
          <Badge variant="secondary" className="capitalize">
            {card.domain}
          </Badge>
          {entry.runtimeStatus !== "embedded" && (
            <StatusBadge
              status={entry.runtimeStatus === "online" ? "up" : "not_configured"}
              label={entry.runtimeStatus === "online" ? "Service online" : "Service offline"}
            />
          )}
        </div>
        <CardTitle className="text-base">{card.name}</CardTitle>
        <CardDescription>{card.summary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {entry.metrics.map((metric) => (
                <div key={metric.label} className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{metric.label}</p>
                  <p
                    className={cn(
                      "text-lg font-semibold",
                      metric.tone === "positive" && "text-positive",
                      metric.tone === "negative" && "text-negative",
                    )}
                  >
                    {metric.value}
                  </p>
                  {metric.note && (
                    <p className="text-[11px] text-muted-foreground">{metric.note}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {entry.lastEvaluated ? `Last evaluated ${formatDate(entry.lastEvaluated)} · ` : ""}
              {entry.evaluationNote}
            </p>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Method</p>
              <p className="text-sm">{card.method}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {card.featureGroups.map((group) => (
                <Badge key={group} variant="secondary" className="font-normal">
                  {group}
                </Badge>
              ))}
            </div>
          </div>
          {entry.calibration.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Confidence calibration</p>
              <CalibrationChart points={entry.calibration} title={`${card.name} calibration`} />
            </div>
          ) : (
            <div className="space-y-1.5 rounded-lg border border-dashed p-4 text-sm">
              <p className="text-xs font-semibold text-muted-foreground">Outputs</p>
              <ul className="list-disc space-y-1 pl-4">
                {card.outputs.map((output) => (
                  <li key={output}>{output}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <Separator />
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <ListBlock title="Intended use" items={card.intendedUse} />
          <ListBlock title="Limitations" items={card.limitations} />
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">Training & evaluation</p>
            <p className="text-sm">{card.trainingData}</p>
            <p className="text-sm text-muted-foreground">{card.evaluation}</p>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">
              Uncertainty & non-guarantee
            </p>
            <p className="text-sm">{card.uncertainty}</p>
            <p className="text-sm text-muted-foreground">{card.nonGuarantee}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
