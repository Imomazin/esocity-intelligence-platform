import { CircleCheck, CircleX, Info, Lock, ScrollText, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/data/empty-state";
import { SectionCard } from "@/components/data/section-card";
import { StatusBadge, type ServiceStatus } from "@/components/indicators/badges";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAdminView } from "@/features/admin/queries";
import { buildDemoSession } from "@/lib/auth/demo";
import { getSession } from "@/lib/auth/session";
import { getServerEnv, type ConfigurationSeverity } from "@/lib/env";
import { formatDateTimeUtc } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Admin",
  description: "System health, configuration review, integration registry and audit trail.",
};

export const dynamic = "force-dynamic";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const SEVERITY_STYLE: Record<
  ConfigurationSeverity,
  { icon: typeof Info; label: string; className: string }
> = {
  error: { icon: CircleX, label: "Error", className: "text-status-critical" },
  warning: { icon: TriangleAlert, label: "Warning", className: "text-status-warning-text" },
  info: { icon: Info, label: "Info", className: "text-muted-foreground" },
};

function DependencyCard({
  name,
  role,
  status,
  label,
  details,
}: {
  name: string;
  role: string;
  status: ServiceStatus;
  label?: string;
  details: { label: string; value: string }[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{name}</p>
          <p className="text-xs text-muted-foreground">{role}</p>
        </div>
      </div>
      <StatusBadge status={status} label={label} className="self-start" />
      <dl className="space-y-1 text-xs">
        {details.map((detail) => (
          <div key={detail.label} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{detail.label}</dt>
            <dd className="num truncate text-right font-medium">{detail.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default async function AdminPage() {
  const env = getServerEnv();
  const session = env.DEMO_MODE ? buildDemoSession(null) : await getSession();

  if (session?.user.role !== "admin") {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Esocity Core · System" title="Admin console" />
        <EmptyState
          icon={Lock}
          title="Administrator access required"
          description="Your role does not include access to the admin console. Ask a workspace administrator for access."
        />
      </div>
    );
  }

  const { health, audit, registries, controls } = await getAdminView();
  const { checks } = health;
  const configErrors = health.configuration.issues.filter((issue) => issue.severity === "error");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Esocity Core · System"
        title="Admin console"
        description="Operational status, configuration review, integration registry and audit trail. Read-only by design: configuration changes ship through environment variables and deployments, never through the UI."
        meta={
          <>
            <StatusBadge
              status={health.status}
              label={health.status === "ok" ? "All systems operational" : undefined}
            />
            <span>v{health.version}</span>
            {health.commit && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono">{health.commit}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span className="capitalize">{health.environment}</span>
            <span aria-hidden>·</span>
            <span>{health.demoMode ? "Demo mode" : "Production mode"}</span>
            <span aria-hidden>·</span>
            <span>Instance uptime {formatUptime(health.uptimeSeconds)}</span>
          </>
        }
        actions={
          <Button variant="outline" size="sm" asChild>
            {/* A plain anchor: the health endpoint returns JSON, not a page. */}
            <a href="/api/health" target="_blank" rel="noreferrer">
              View /api/health
            </a>
          </Button>
        }
      />

      <section aria-labelledby="health-heading" className="space-y-3">
        <h2
          id="health-heading"
          className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
        >
          Service health
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <DependencyCard
            name="PostgreSQL"
            role={
              checks.database.required ? "Required in production mode" : "Optional in demo mode"
            }
            status={checks.database.status}
            label={checks.database.status === "not_configured" ? "Not configured" : undefined}
            details={[
              {
                label: "Latency",
                value:
                  checks.database.latencyMs === undefined ? "—" : `${checks.database.latencyMs} ms`,
              },
              {
                label: "Detail",
                value:
                  checks.database.error ??
                  (checks.database.status === "up" ? "Connected" : "DATABASE_URL unset"),
              },
            ]}
          />
          <DependencyCard
            name="Cache & rate limits"
            role={
              checks.cache.kind === "upstash"
                ? "Upstash Redis (shared)"
                : "In-memory (per instance)"
            }
            status={checks.cache.status}
            details={[
              {
                label: "Latency",
                value: checks.cache.latencyMs === undefined ? "—" : `${checks.cache.latencyMs} ms`,
              },
              { label: "Detail", value: checks.cache.error ?? "Responding" },
            ]}
          />
          <DependencyCard
            name="Python ML API"
            role="Optional — TypeScript engines are the fallback"
            status={checks.mlApi.status}
            label={checks.mlApi.status === "not_configured" ? "Not configured" : undefined}
            details={[
              { label: "Version", value: checks.mlApi.version ?? "—" },
              {
                label: "XGBoost",
                value:
                  checks.mlApi.xgboostAvailable === undefined
                    ? "—"
                    : checks.mlApi.xgboostAvailable
                      ? "Available"
                      : "Fallback GBM",
              },
              {
                label: "Detail",
                value:
                  checks.mlApi.error ??
                  (checks.mlApi.status === "up"
                    ? `${checks.mlApi.latencyMs ?? "—"} ms`
                    : "ML_API_URL unset"),
              },
            ]}
          />
          <DependencyCard
            name="Market data"
            role="MarketDataProvider"
            status={checks.marketData.status}
            details={[
              { label: "Provider", value: checks.marketData.provider },
              { label: "Data", value: checks.marketData.simulated ? "Simulated" : "Live" },
            ]}
          />
          <DependencyCard
            name="Sports data"
            role="SportsDataProvider"
            status={checks.sportsData.status}
            details={[
              { label: "Provider", value: checks.sportsData.provider },
              { label: "Data", value: checks.sportsData.simulated ? "Simulated" : "Live" },
            ]}
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Configuration review"
          description={`${health.configuration.errors} errors · ${health.configuration.warnings} warnings · variable names only, never values`}
        >
          {health.configuration.issues.length === 0 ? (
            <EmptyState icon={CircleCheck} title="No configuration issues" className="py-6" />
          ) : (
            <ul className="divide-y text-sm">
              {health.configuration.issues.map((issue) => {
                const style = SEVERITY_STYLE[issue.severity];
                const Icon = style.icon;
                return (
                  <li
                    key={`${issue.severity}-${issue.variable}-${issue.message}`}
                    className="flex gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <Icon className={cn("mt-0.5 size-4 shrink-0", style.className)} aria-hidden />
                    <div className="min-w-0 space-y-0.5">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold">{style.label}</span>
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {issue.variable}
                        </code>
                      </p>
                      <p className="text-muted-foreground">{issue.message}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {configErrors.length > 0 && (
            <p className="mt-3 text-xs text-status-critical">
              Configuration errors make /api/health report “down” (HTTP 503) until resolved.
            </p>
          )}
        </SectionCard>

        <SectionCard
          title="Safety controls"
          description="Guardrails enforced in code for this release"
        >
          <ul className="divide-y text-sm">
            {controls.map((control) => (
              <li key={control.label} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                {control.enforced ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-status-good" aria-hidden />
                ) : (
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{control.label}</span>
                    <span className="text-xs text-muted-foreground">{control.value}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{control.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <section aria-labelledby="registry-heading" className="space-y-3">
        <h2
          id="registry-heading"
          className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
        >
          Integration registry
        </h2>
        {registries.map((registry) => (
          <SectionCard
            key={registry.key}
            title={registry.title}
            description={
              <>
                {registry.description} Selected by{" "}
                <code className="font-mono">{registry.variable}</code>.
              </>
            }
          >
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-56">Provider</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead>Coverage</TableHead>
                  <TableHead className="w-60">Environment variables</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {registry.providers.map((provider) => (
                  <TableRow key={provider.id} className="align-top">
                    <TableCell className="whitespace-normal">
                      <p className="font-medium">{provider.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{provider.id}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={provider.status === "available" ? "secondary" : "outline"}>
                          {provider.status === "available" ? "Implemented" : "Planned"}
                        </Badge>
                        {provider.id === registry.active && (
                          <StatusBadge status="up" label="Active" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <p>{provider.coverage}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{provider.notes}</p>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {provider.envVars.length === 0 ? (
                        <span className="text-xs text-muted-foreground">None — key-free</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {provider.envVars.map((name) => (
                            <code
                              key={name}
                              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                            >
                              {name}
                            </code>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        ))}
      </section>

      <SectionCard
        title="Audit trail"
        description={
          audit.source === "database"
            ? "Latest 40 events from PostgreSQL (append-only: UPDATE and DELETE are blocked by a trigger)"
            : "Latest 40 events from this instance's memory buffer — resets on redeploy. Configure DATABASE_URL for a durable trail."
        }
      >
        {audit.events.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audited actions yet"
            description="Place a paper order, reset the paper account or run a backtest to generate audit events."
          />
        ) : (
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Time (UTC)</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Request</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="num text-xs">
                    {formatDateTimeUtc(event.occurredAt)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{event.action}</TableCell>
                  <TableCell>
                    <StatusBadge
                      status={event.outcome === "success" ? "up" : "down"}
                      label={event.outcome === "success" ? "Success" : "Failure"}
                    />
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="capitalize">{event.actorType}</span>
                    {event.actorId && (
                      <span className="block font-mono text-muted-foreground">
                        {event.actorId.slice(0, 8)}…
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {event.resourceType ?? "—"}
                    {event.resourceId && (
                      <span className="block font-mono text-muted-foreground">
                        {event.resourceId.slice(0, 12)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {event.requestId?.slice(0, 8) ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
