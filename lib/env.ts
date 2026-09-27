import { z } from "zod";

/**
 * Server-side environment validation.
 *
 * - Every integration is OPTIONAL so that `next build` succeeds with no environment variables
 *   at all (the first Vercel deployment runs in demo mode).
 * - Values are validated lazily on first use (never at import time), so a missing optional
 *   variable cannot crash the build.
 * - Cross-field production requirements (e.g. DATABASE_URL when DEMO_MODE=false) are reported
 *   by `getConfigurationIssues()` and enforced by the data layer at runtime.
 * - Never log or return raw secret values; error messages reference variable names only.
 */

export const MARKET_DATA_PROVIDER_IDS = [
  "demo",
  "polygon",
  "twelvedata",
  "alphavantage",
  "fmp",
  "enterprise",
] as const;
export type MarketDataProviderId = (typeof MARKET_DATA_PROVIDER_IDS)[number];

export const SPORTS_DATA_PROVIDER_IDS = ["demo", "sportmonks", "api-football", "opta"] as const;
export type SportsDataProviderId = (typeof SPORTS_DATA_PROVIDER_IDS)[number];

export const BROKER_ADAPTER_IDS = ["paper", "alpaca", "ibkr"] as const;
export type BrokerAdapterId = (typeof BROKER_ADAPTER_IDS)[number];

function blankToUndefined(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(blankToUndefined, schema.optional());
}

function flag(defaultValue: boolean) {
  return z
    .preprocess(
      (value) => {
        const normalised = blankToUndefined(value);
        return typeof normalised === "string" ? normalised.toLowerCase() : normalised;
      },
      z.enum(["true", "false", "1", "0", "yes", "no", "on", "off"]).optional(),
    )
    .transform((value) =>
      value === undefined ? defaultValue : ["true", "1", "yes", "on"].includes(value),
    );
}

function withDefault<T extends z.ZodType>(schema: T) {
  return z.preprocess(blankToUndefined, schema);
}

export const serverEnvSchema = z
  .object({
    NODE_ENV: withDefault(z.enum(["development", "test", "production"]).default("development")),
    DEMO_MODE: flag(true),
    DEMO_AS_OF: optional(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, "Use YYYY-MM-DD or an ISO-8601 UTC timestamp"),
    ),
    DATABASE_URL: optional(
      z
        .string()
        .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must start with postgres:// or postgresql://"),
    ),
    UPSTASH_REDIS_REST_URL: optional(z.url({ protocol: /^https?$/ })),
    UPSTASH_REDIS_REST_TOKEN: optional(z.string().min(1)),
    ML_API_URL: optional(z.url({ protocol: /^https?$/ })),
    ML_API_KEY: optional(z.string().min(16, "ML_API_KEY must be at least 16 characters")),
    ML_API_TIMEOUT_MS: withDefault(z.coerce.number().int().min(250).max(30_000).default(2_500)),
    AUTH_SECRET: optional(z.string().min(32, "AUTH_SECRET must be at least 32 characters")),
    MARKET_DATA_PROVIDER: withDefault(z.enum(MARKET_DATA_PROVIDER_IDS).default("demo")),
    SPORTS_DATA_PROVIDER: withDefault(z.enum(SPORTS_DATA_PROVIDER_IDS).default("demo")),
    BROKER_ADAPTER: withDefault(z.enum(BROKER_ADAPTER_IDS).default("paper")),
    RATE_LIMIT_ENABLED: flag(true),
    LOG_LEVEL: withDefault(z.enum(["debug", "info", "warn", "error"]).default("info")),
    VERCEL_ENV: optional(z.enum(["production", "preview", "development"])),
    VERCEL_GIT_COMMIT_SHA: optional(z.string()),
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.UPSTASH_REDIS_REST_URL) !== Boolean(env.UPSTASH_REDIS_REST_TOKEN)) {
      ctx.addIssue({
        code: "custom",
        path: ["UPSTASH_REDIS_REST_URL"],
        message: "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set together",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvironmentValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid server environment configuration:\n  - ${issues.join("\n  - ")}`);
    this.name = "EnvironmentValidationError";
  }
}

let cachedEnv: ServerEnv | null = null;

function readRawEnv(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const keys = Object.keys(serverEnvSchema.shape) as (keyof ServerEnv)[];
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

/** Parse an arbitrary env record. Exposed for tests. */
export function parseServerEnv(source: NodeJS.ProcessEnv): ServerEnv {
  const result = serverEnvSchema.safeParse(readRawEnv(source));
  if (!result.success) {
    throw new EnvironmentValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`),
    );
  }
  return result.data;
}

/** Validated server environment (cached after first successful parse). Server-only. */
export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("getServerEnv() must not be called in the browser");
  }
  cachedEnv ??= parseServerEnv(process.env);
  return cachedEnv;
}

/** Test helper — clears the memoised environment. */
export function resetServerEnvCache(): void {
  cachedEnv = null;
}

export function isDemoMode(): boolean {
  return getServerEnv().DEMO_MODE;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(getServerEnv().DATABASE_URL);
}

export function isRedisConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

export type ConfigurationSeverity = "error" | "warning" | "info";

export interface ConfigurationIssue {
  severity: ConfigurationSeverity;
  variable: string;
  message: string;
}

/**
 * Runtime configuration review used by /api/health and the Admin console. Never includes
 * secret values.
 */
export function getConfigurationIssues(env: ServerEnv = getServerEnv()): ConfigurationIssue[] {
  const issues: ConfigurationIssue[] = [];

  if (!env.DEMO_MODE) {
    if (!env.DATABASE_URL) {
      issues.push({
        severity: "error",
        variable: "DATABASE_URL",
        message: "Production mode (DEMO_MODE=false) requires PostgreSQL.",
      });
    }
    if (!env.AUTH_SECRET) {
      issues.push({
        severity: "error",
        variable: "AUTH_SECRET",
        message: "Production mode requires AUTH_SECRET for the authentication provider.",
      });
    }
    issues.push({
      severity: "error",
      variable: "AUTH_PROVIDER",
      message:
        "No production authentication provider is attached yet. See docs/SECURITY.md → Authentication.",
    });
  }

  if (env.MARKET_DATA_PROVIDER !== "demo") {
    issues.push({
      severity: "error",
      variable: "MARKET_DATA_PROVIDER",
      message: `Provider "${env.MARKET_DATA_PROVIDER}" is planned but not implemented in this release.`,
    });
  }
  if (env.SPORTS_DATA_PROVIDER !== "demo") {
    issues.push({
      severity: "error",
      variable: "SPORTS_DATA_PROVIDER",
      message: `Provider "${env.SPORTS_DATA_PROVIDER}" is planned but not implemented in this release.`,
    });
  }
  if (env.BROKER_ADAPTER !== "paper") {
    issues.push({
      severity: "error",
      variable: "BROKER_ADAPTER",
      message: "Only the paper broker is permitted. Live execution is disabled by design.",
    });
  }

  if (!env.DATABASE_URL && env.DEMO_MODE) {
    issues.push({
      severity: "info",
      variable: "DATABASE_URL",
      message: "Not set — paper trading uses the demo key-value store (in-memory or Upstash).",
    });
  }
  if (!env.UPSTASH_REDIS_REST_URL) {
    issues.push({
      severity: "info",
      variable: "UPSTASH_REDIS_REST_URL",
      message: "Not set — caching and rate limiting use per-instance memory.",
    });
  }
  if (env.ML_API_URL) {
    const host = new URL(env.ML_API_URL).hostname;
    if (env.VERCEL_ENV && ["localhost", "127.0.0.1", "0.0.0.0"].includes(host)) {
      issues.push({
        severity: "warning",
        variable: "ML_API_URL",
        message: "Points at localhost on Vercel — the remote engine will be skipped.",
      });
    }
  } else {
    issues.push({
      severity: "info",
      variable: "ML_API_URL",
      message: "Not set — the built-in TypeScript intelligence engines are used.",
    });
  }

  return issues;
}
