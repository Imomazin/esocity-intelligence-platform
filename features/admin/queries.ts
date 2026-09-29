import "server-only";

import { listRecentAuditEvents, type AuditEvent } from "@/lib/audit";
import { getServerEnv } from "@/lib/env";
import { getHealthReport, type HealthReport } from "@/lib/health";
import type { CompetitionFreshness, SymbolFreshness } from "@/lib/ingestion/monitoring";
import {
  marketPipelineStatus,
  sportsPipelineStatus,
  type PipelineStatusView,
} from "@/lib/ingestion/status";
import { logger } from "@/lib/logger";
import { MARKET_DATA_PROVIDERS, type ProviderDescriptor } from "@/lib/markets/providers/registry";
import { summarizeInfrastructureError } from "@/lib/security/safe-error";
import { SPORTS_DATA_PROVIDERS } from "@/lib/sports/providers/registry";
import { BROKER_ADAPTERS } from "@/lib/trade/brokers/registry";

export interface ProviderRegistryView {
  key: "markets" | "sports" | "brokers";
  title: string;
  description: string;
  variable: string;
  active: string;
  providers: ProviderDescriptor<string>[];
}

export interface SafetyControl {
  label: string;
  value: string;
  enforced: boolean;
  detail: string;
}

export type PipelinePanel<T> =
  | { state: "demo" }
  | { state: "error"; providerName: string; error: string }
  | { state: "ready"; providerName: string; schedule: string; view: PipelineStatusView<T> };

export interface AdminView {
  health: HealthReport;
  audit: { events: AuditEvent[]; source: "database" | "memory" };
  registries: ProviderRegistryView[];
  controls: SafetyControl[];
  pipeline: {
    markets: PipelinePanel<SymbolFreshness>;
    sports: PipelinePanel<CompetitionFreshness>;
  };
}

/** Cron schedules in vercel.json, described for operators. */
export const INGESTION_SCHEDULES = {
  markets: "Weekdays 22:15 UTC, after the US close · /api/cron/ingest/markets",
  sports: "Daily 06:15 UTC · /api/cron/ingest/sports",
} as const;

async function pipelinePanel<T>(
  domain: "markets" | "sports",
  providerName: string,
  load: () => Promise<PipelineStatusView<T> | null>,
): Promise<PipelinePanel<T>> {
  try {
    const view = await load();
    return view
      ? { state: "ready", providerName, schedule: INGESTION_SCHEDULES[domain], view }
      : { state: "demo" };
  } catch (error) {
    logger.warn("admin.pipeline_status_failed", { domain, error });
    return { state: "error", providerName, error: summarizeInfrastructureError(error) };
  }
}

/**
 * Admin console data. Everything here is read-only and secret-free: configuration is reported
 * as variable NAMES and states, never values.
 */
export async function getAdminView(): Promise<AdminView> {
  const env = getServerEnv();
  const providerName = (list: ProviderDescriptor<string>[], id: string) =>
    list.find((entry) => entry.id === id)?.name ?? id;
  const [health, audit, markets, sports] = await Promise.all([
    getHealthReport(),
    listRecentAuditEvents(40),
    pipelinePanel(
      "markets",
      providerName(MARKET_DATA_PROVIDERS, env.MARKET_DATA_PROVIDER),
      marketPipelineStatus,
    ),
    pipelinePanel(
      "sports",
      providerName(SPORTS_DATA_PROVIDERS, env.SPORTS_DATA_PROVIDER),
      sportsPipelineStatus,
    ),
  ]);

  const registries: ProviderRegistryView[] = [
    {
      key: "markets",
      title: "Market data providers",
      description: "Implementations of MarketDataProvider (lib/markets/providers).",
      variable: "MARKET_DATA_PROVIDER",
      active: env.MARKET_DATA_PROVIDER,
      providers: MARKET_DATA_PROVIDERS,
    },
    {
      key: "sports",
      title: "Sports data providers",
      description: "Implementations of SportsDataProvider (lib/sports/providers).",
      variable: "SPORTS_DATA_PROVIDER",
      active: env.SPORTS_DATA_PROVIDER,
      providers: SPORTS_DATA_PROVIDERS,
    },
    {
      key: "brokers",
      title: "Broker adapters",
      description:
        "Implementations of BrokerAdapter (lib/trade/brokers). Live adapters are refused at runtime.",
      variable: "BROKER_ADAPTER",
      active: env.BROKER_ADAPTER,
      providers: BROKER_ADAPTERS,
    },
  ];

  const controls: SafetyControl[] = [
    {
      label: "Live order execution",
      value: "Disabled",
      enforced: true,
      detail:
        "Only the paper broker can be constructed; any other BROKER_ADAPTER value fails configuration review.",
    },
    {
      label: "Paper trading store",
      value: env.DATABASE_URL ? "PostgreSQL (row-locked ledger)" : "Key-value store (demo)",
      enforced: true,
      detail:
        "Orders are validated server-side for cash, holdings, quantity and symbol before any fill.",
    },
    {
      label: "Audit trail",
      value: env.DATABASE_URL
        ? "PostgreSQL · append-only trigger"
        : "Structured logs + memory buffer",
      enforced: true,
      detail:
        "Orders, rejections, resets and backtests are audited. Sensitive metadata keys are redacted.",
    },
    {
      label: "API rate limiting",
      value: env.RATE_LIMIT_ENABLED
        ? `Enabled · ${env.UPSTASH_REDIS_REST_URL ? "shared (Upstash)" : "per instance"}`
        : "Disabled",
      enforced: env.RATE_LIMIT_ENABLED,
      detail: "Fixed-window limits on reads, paper orders and backtests, keyed by client address.",
    },
    {
      label: "Authentication",
      value: env.DEMO_MODE ? "Demo mode (no accounts)" : "Provider required",
      enforced: !env.DEMO_MODE,
      detail: env.DEMO_MODE
        ? "Every visitor shares the Demo Analyst identity; an anonymous cookie isolates paper portfolios."
        : "Attach Clerk or Auth.js at lib/auth/session.ts before exposing production mode.",
    },
  ];

  return { health, audit, registries, controls, pipeline: { markets, sports } };
}
