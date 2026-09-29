import { checkDatabaseHealth, type DatabaseHealth } from "@/db/client";
import { getConfigurationIssues, getServerEnv, type ConfigurationIssue } from "@/lib/env";
import { marketPipelineStatus, sportsPipelineStatus } from "@/lib/ingestion/status";
import { getKeyValueStore } from "@/lib/kv";
import { logger } from "@/lib/logger";
import { getMarketDataProvider } from "@/lib/markets/providers";
import { getIntelligenceEngine, type EngineHealth } from "@/lib/ml/engine";
import { summarizeInfrastructureError } from "@/lib/security/safe-error";
import { APP_VERSION } from "@/lib/site";
import { getSportsDataProvider } from "@/lib/sports/providers";

export type OverallStatus = "ok" | "degraded" | "down";

export interface DataCheck {
  status: "up" | "degraded" | "down";
  provider: string;
  simulated: boolean;
  /** Licensed data only: freshness summary from the ingestion pipeline. */
  freshness?: string;
  lastIngestion?: { status: string; finishedAt: string | null } | null;
  error?: string;
}

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
    marketData: DataCheck;
    sportsData: DataCheck;
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

/**
 * Provider resolution plus, for licensed data, the ingestion pipeline's freshness: stale or
 * partially ingested data is `degraded`; nothing servable (or an unreachable store) is `down`.
 */
async function dataHealth(
  resolve: () => { id: string; isSimulated: boolean },
  pipeline: () => Promise<{
    assessment: {
      status: "ok" | "degraded" | "down";
      summary: string;
      lastRun: { status: string; finishedAt: string | null } | null;
    };
  } | null>,
): Promise<DataCheck> {
  let check: DataCheck;
  try {
    const provider = resolve();
    check = { status: "up", provider: provider.id, simulated: provider.isSimulated };
  } catch (error) {
    return {
      status: "down",
      provider: "unavailable",
      simulated: false,
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
  if (check.simulated) return check;
  try {
    const view = await withTimeout(pipeline(), 3_000);
    if (!view) return check;
    const { assessment } = view;
    return {
      ...check,
      status: assessment.status === "ok" ? "up" : assessment.status,
      freshness: assessment.summary,
      lastIngestion: assessment.lastRun
        ? { status: assessment.lastRun.status, finishedAt: assessment.lastRun.finishedAt }
        : null,
    };
  } catch (error) {
    logger.warn("data.health_check_failed", { provider: check.provider, error });
    return { ...check, status: "down", error: summarizeInfrastructureError(error) };
  }
}

/**
 * Aggregate health. `down` when a REQUIRED dependency is unavailable (PostgreSQL in production
 * mode, any configured data provider — including licensed data with nothing servable) or
 * configuration has errors; `degraded` when an optional dependency is down or licensed data is
 * stale; `ok` otherwise.
 */
export async function getHealthReport(): Promise<HealthReport> {
  const env = getServerEnv();
  const [database, cache, mlApi, marketData, sportsData] = await Promise.all([
    checkDatabaseHealth(),
    cacheHealth(),
    getIntelligenceEngine().health(),
    dataHealth(getMarketDataProvider, () => marketPipelineStatus()),
    dataHealth(getSportsDataProvider, () => sportsPipelineStatus()),
  ]);
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
  } else if (
    database.status === "down" ||
    cache.status === "down" ||
    mlApi.status === "down" ||
    marketData.status === "degraded" ||
    sportsData.status === "degraded"
  ) {
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
