import { checkDatabaseHealth, type DatabaseHealth } from "@/db/client";
import { getConfigurationIssues, getServerEnv, type ConfigurationIssue } from "@/lib/env";
import { getKeyValueStore } from "@/lib/kv";
import { logger } from "@/lib/logger";
import { getMarketDataProvider } from "@/lib/markets/providers";
import { getIntelligenceEngine, type EngineHealth } from "@/lib/ml/engine";
import { summarizeInfrastructureError } from "@/lib/security/safe-error";
import { APP_VERSION } from "@/lib/site";
import { getSportsDataProvider } from "@/lib/sports/providers";

export type OverallStatus = "ok" | "degraded" | "down";

export interface HealthReport {
  status: OverallStatus;
  service: "esocity-web";
  version: string;
  commit: string | null;
  environment: string;
  demoMode: boolean;
  timestamp: string;
  uptimeSeconds: number;
  checks: {
    database: DatabaseHealth & { required: boolean };
    cache: {
      status: "up" | "down";
      kind: "memory" | "upstash";
      latencyMs?: number;
      error?: string;
    };
    mlApi: EngineHealth & { required: false };
    marketData: { status: "up" | "down"; provider: string; simulated: boolean; error?: string };
    sportsData: { status: "up" | "down"; provider: string; simulated: boolean; error?: string };
  };
  configuration: { errors: number; warnings: number; issues: ConfigurationIssue[] };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function cacheHealth(): Promise<HealthReport["checks"]["cache"]> {
  const store = getKeyValueStore();
  const started = performance.now();
  try {
    const ok = await withTimeout(store.ping(), 2_000);
    return {
      status: ok ? "up" : "down",
      kind: store.kind,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    logger.warn("cache.health_check_failed", { error });
    return { status: "down", kind: store.kind, error: summarizeInfrastructureError(error) };
  }
}

function providerHealth(resolve: () => { id: string; isSimulated: boolean }): {
  status: "up" | "down";
  provider: string;
  simulated: boolean;
  error?: string;
} {
  try {
    const provider = resolve();
    return { status: "up", provider: provider.id, simulated: provider.isSimulated };
  } catch (error) {
    return {
      status: "down",
      provider: "unavailable",
      simulated: false,
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

/**
 * Aggregate health. `down` when a REQUIRED dependency is unavailable (PostgreSQL in production
 * mode, any configured data provider) or configuration has errors; `degraded` when an optional
 * dependency is down; `ok` otherwise.
 */
export async function getHealthReport(): Promise<HealthReport> {
  const env = getServerEnv();
  const [database, cache, mlApi] = await Promise.all([
    checkDatabaseHealth(),
    cacheHealth(),
    getIntelligenceEngine().health(),
  ]);
  const marketData = providerHealth(getMarketDataProvider);
  const sportsData = providerHealth(getSportsDataProvider);
  const issues = getConfigurationIssues(env);
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const databaseRequired = !env.DEMO_MODE;

  let status: OverallStatus = "ok";
  if (
    errors > 0 ||
    marketData.status === "down" ||
    sportsData.status === "down" ||
    (databaseRequired && database.status !== "up")
  ) {
    status = "down";
  } else if (database.status === "down" || cache.status === "down" || mlApi.status === "down") {
    status = "degraded";
  }

  return {
    status,
    service: "esocity-web",
    version: APP_VERSION,
    commit: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    environment: env.VERCEL_ENV ?? env.NODE_ENV,
    demoMode: env.DEMO_MODE,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks: {
      database: { ...database, required: databaseRequired },
      cache,
      mlApi: { ...mlApi, required: false },
      marketData,
      sportsData,
    },
    configuration: { errors, warnings, issues },
  };
}
