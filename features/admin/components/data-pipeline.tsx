import { DatabaseZap, FlaskConical } from "lucide-react";

import { EmptyState } from "@/components/data/empty-state";
import { KeyValueList } from "@/components/data/key-value-list";
import { SectionCard } from "@/components/data/section-card";
import { StatusBadge, type ServiceStatus } from "@/components/indicators/badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PipelinePanel } from "@/features/admin/queries";
import { formatDateTimeUtc, formatPercent } from "@/lib/format";
import type {
  CompetitionFreshness,
  FreshnessStatus,
  PipelineStatus,
  SymbolFreshness,
} from "@/lib/ingestion/monitoring";
import type { IngestionRunRecord, IngestionStatus } from "@/lib/ingestion/types";

const PIPELINE_BADGE: Record<PipelineStatus, ServiceStatus> = {
  ok: "up",
  degraded: "degraded",
  down: "down",
};

const FRESHNESS_BADGE: Record<FreshnessStatus, { status: ServiceStatus; label: string }> = {
  fresh: { status: "up", label: "Fresh" },
  stale: { status: "degraded", label: "Stale" },
  missing: { status: "down", label: "Missing" },
};

const RUN_BADGE: Record<IngestionStatus, { status: ServiceStatus; label: string }> = {
  running: { status: "not_configured", label: "Running" },
  succeeded: { status: "up", label: "Succeeded" },
  partial: { status: "degraded", label: "Partial" },
  failed: { status: "down", label: "Failed" },
  abandoned: { status: "down", label: "Abandoned" },
};

function duration(run: IngestionRunRecord): string {
  if (!run.finishedAt) return "—";
  const seconds = Math.max(0, (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1_000);
  return seconds >= 60 ? `${(seconds / 60).toFixed(1)} min` : `${Math.round(seconds)} s`;
}

function RunSummary({ panel }: { panel: Extract<PipelinePanel<unknown>, { state: "ready" }> }) {
  const { lastRun, lastSuccess } = panel.view.assessment;
  return (
    <div className="mb-4 space-y-3">
      <KeyValueList
        items={[
          {
            label: "Last run",
            value: lastRun ? (
              <span className="inline-flex items-center gap-2">
                <StatusBadge {...RUN_BADGE[lastRun.status]} />
                {formatDateTimeUtc(lastRun.startedAt)}
              </span>
            ) : (
              "Never"
            ),
          },
          {
            label: "Last successful run",
            value: lastSuccess?.finishedAt ? formatDateTimeUtc(lastSuccess.finishedAt) : "Never",
          },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        {panel.schedule} · manual:{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
          pnpm ingest {panel.view.domain}
        </code>
      </p>
    </div>
  );
}

function NotLicensed({ domain }: { domain: "markets" | "sports" }) {
  return (
    <EmptyState
      icon={FlaskConical}
      className="py-6"
      title="Synthetic demo data — no ingestion pipeline"
      description={
        domain === "markets"
          ? "Set MARKET_DATA_PROVIDER=polygon with POLYGON_API_KEY and DATABASE_URL to ingest licensed end-of-day prices."
          : "Set SPORTS_DATA_PROVIDER=api-football with API_FOOTBALL_KEY and DATABASE_URL to ingest licensed fixtures and results."
      }
    />
  );
}

function Unreadable({ error }: { error: string }) {
  return (
    <EmptyState
      icon={DatabaseZap}
      className="py-6"
      title="Pipeline status unavailable"
      description={`The ingestion tables could not be read (${error}). Check PostgreSQL and run migrations.`}
    />
  );
}

export function MarketPipelineCard({ panel }: { panel: PipelinePanel<SymbolFreshness> }) {
  const ready = panel.state === "ready" ? panel : null;
  return (
    <SectionCard
      title={`Market data${panel.state === "demo" ? "" : ` · ${panel.providerName}`}`}
      description={ready?.view.assessment.summary ?? "Daily bars, reference data and freshness"}
      action={
        ready ? <StatusBadge status={PIPELINE_BADGE[ready.view.assessment.status]} /> : undefined
      }
    >
      {panel.state === "demo" && <NotLicensed domain="markets" />}
      {panel.state === "error" && <Unreadable error={panel.error} />}
      {ready && (
        <>
          <RunSummary panel={ready} />
          <Table className="min-w-[440px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Symbol</TableHead>
                <TableHead>Last bar</TableHead>
                <TableHead className="text-right">Sessions behind</TableHead>
                <TableHead className="text-right">Bars</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ready.view.assessment.items.map((item) => {
                const badge =
                  item.status === "fresh" && !item.servable
                    ? { status: "degraded" as const, label: "Building history" }
                    : FRESHNESS_BADGE[item.status];
                return (
                  <TableRow key={item.symbol}>
                    <TableCell className="font-mono text-xs font-medium">{item.symbol}</TableCell>
                    <TableCell className="num text-xs">{item.last ?? "—"}</TableCell>
                    <TableCell className="num text-right text-xs">
                      {item.sessionsBehind ?? "—"}
                    </TableCell>
                    <TableCell className="num text-right text-xs">{item.bars}</TableCell>
                    <TableCell>
                      <StatusBadge {...badge} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Expected through {ready.view.assessment.items[0]?.expectedDate ?? "—"} (last completed
            NYSE session). One session of lag is normal before the post-close job runs; symbols need
            six months of history before they are analysed.
          </p>
        </>
      )}
    </SectionCard>
  );
}

export function SportsPipelineCard({ panel }: { panel: PipelinePanel<CompetitionFreshness> }) {
  const ready = panel.state === "ready" ? panel : null;
  return (
    <SectionCard
      title={`Sports data${panel.state === "demo" ? "" : ` · ${panel.providerName}`}`}
      description={
        ready?.view.assessment.summary ?? "Fixtures, results, expected goals, availability"
      }
      action={
        ready ? <StatusBadge status={PIPELINE_BADGE[ready.view.assessment.status]} /> : undefined
      }
    >
      {panel.state === "demo" && <NotLicensed domain="sports" />}
      {panel.state === "error" && <Unreadable error={panel.error} />}
      {ready && (
        <>
          <RunSummary panel={ready} />
          <Table className="min-w-[460px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Competition</TableHead>
                <TableHead className="text-right">Results</TableHead>
                <TableHead className="text-right">Upcoming</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead className="text-right">xG</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ready.view.assessment.items.map((item) => (
                <TableRow key={item.key}>
                  <TableCell className="text-xs whitespace-normal">
                    <span className="font-medium">
                      {item.fixtures === 0 ? `League ${item.key.replace(/\D/g, "")}` : item.name}
                    </span>
                    <span className="block text-muted-foreground">
                      {item.fixtures === 0
                        ? "Not ingested yet"
                        : `${item.season} · last result ${item.lastResult ?? "—"}`}
                    </span>
                  </TableCell>
                  <TableCell className="num text-right text-xs">
                    {item.finished}/{item.fixtures}
                  </TableCell>
                  <TableCell className="num text-right text-xs">{item.upcoming}</TableCell>
                  <TableCell className="num text-right text-xs">{item.overdue}</TableCell>
                  <TableCell className="num text-right text-xs">
                    {item.xgCoverage === null ? "—" : formatPercent(item.xgCoverage, 0)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge {...FRESHNESS_BADGE[item.status]} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            A result is overdue when a fixture is still unresolved a day after kick-off.
          </p>
        </>
      )}
    </SectionCard>
  );
}

export function IngestionRunsCard({
  markets,
  sports,
}: {
  markets: PipelinePanel<SymbolFreshness>;
  sports: PipelinePanel<CompetitionFreshness>;
}) {
  const runs = [
    ...(markets.state === "ready" ? markets.view.runs : []),
    ...(sports.state === "ready" ? sports.view.runs : []),
  ].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (markets.state !== "ready" && sports.state !== "ready") return null;
  return (
    <SectionCard
      title="Recent ingestion runs"
      description="Scheduled (cron) and manual runs, newest first — also recorded in the audit trail"
    >
      {runs.length === 0 ? (
        <EmptyState
          icon={DatabaseZap}
          title="No ingestion runs yet"
          description="Run `pnpm ingest markets` / `pnpm ingest sports`, or wait for the scheduled job."
        />
      ) : (
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Started (UTC)</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id} className="align-top">
                <TableCell className="num text-xs">{formatDateTimeUtc(run.startedAt)}</TableCell>
                <TableCell className="text-xs capitalize">{run.domain}</TableCell>
                <TableCell className="text-xs">
                  {run.trigger === "schedule" ? "Schedule" : "Manual"}
                </TableCell>
                <TableCell>
                  <StatusBadge {...RUN_BADGE[run.status]} />
                </TableCell>
                <TableCell className="num text-right text-xs">{duration(run)}</TableCell>
                <TableCell className="num text-right text-xs">{run.requestCount}</TableCell>
                <TableCell className="num text-right text-xs">{run.rowsWritten}</TableCell>
                <TableCell className="max-w-72 text-xs whitespace-normal text-muted-foreground">
                  {run.error ??
                    (run.warnings.length > 0
                      ? run.warnings.join(" ")
                      : `${run.items.length} item${run.items.length === 1 ? "" : "s"}`)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}
