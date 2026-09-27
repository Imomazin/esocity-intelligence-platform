import "server-only";

import { listRecentAuditEvents, type AuditEvent } from "@/lib/audit";
import { getServerEnv } from "@/lib/env";
import { getHealthReport, type HealthReport } from "@/lib/health";
import { MARKET_DATA_PROVIDERS, type ProviderDescriptor } from "@/lib/markets/providers/registry";
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

export interface AdminView {
  health: HealthReport;
  audit: { events: AuditEvent[]; source: "database" | "memory" };
  registries: ProviderRegistryView[];
  controls: SafetyControl[];
}

/**
 * Admin console data. Everything here is read-only and secret-free: configuration is reported
 * as variable NAMES and states, never values.
 */
export async function getAdminView(): Promise<AdminView> {
  const env = getServerEnv();
  const [health, audit] = await Promise.all([getHealthReport(), listRecentAuditEvents(40)]);

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

  return { health, audit, registries, controls };
}
