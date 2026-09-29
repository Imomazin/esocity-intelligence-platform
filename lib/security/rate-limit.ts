import { getServerEnv } from "@/lib/env";
import { getKeyValueStore, kvKey } from "@/lib/kv";
import { logger } from "@/lib/logger";

/**
 * Fixed-window rate limiter over the shared key-value store (Upstash in production, memory
 * otherwise). Fixed windows are simple and explainable; swap for a sliding window / token
 * bucket (e.g. @upstash/ratelimit) if burst behaviour at window edges becomes a concern.
 */

export interface RateLimitPolicy {
  /** Logical bucket, e.g. "trade:orders". */
  key: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window resets. */
  resetSeconds: number;
}

export const RATE_LIMITS = {
  read: { key: "api:read", limit: 240, windowSeconds: 60 },
  orders: { key: "trade:orders", limit: 30, windowSeconds: 60 },
  backtests: { key: "backtests:run", limit: 20, windowSeconds: 60 },
  cron: { key: "cron:ingest", limit: 10, windowSeconds: 60 },
} satisfies Record<string, RateLimitPolicy>;

export async function checkRateLimit(
  identifier: string,
  policy: RateLimitPolicy,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  if (!getServerEnv().RATE_LIMIT_ENABLED) {
    return { success: true, limit: policy.limit, remaining: policy.limit, resetSeconds: 0 };
  }

  const windowStart = Math.floor(now / 1000 / policy.windowSeconds) * policy.windowSeconds;
  const resetSeconds = windowStart + policy.windowSeconds - Math.floor(now / 1000);
  const key = kvKey("ratelimit", policy.key, identifier, windowStart);

  try {
    const count = await getKeyValueStore().increment(key, policy.windowSeconds);
    return {
      success: count <= policy.limit,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - count),
      resetSeconds,
    };
  } catch (error) {
    // Fail open: a cache outage must not take the API down. The failure is logged loudly.
    logger.warn("ratelimit.store_unavailable", { policy: policy.key, error });
    return { success: true, limit: policy.limit, remaining: policy.limit, resetSeconds };
  }
}

/** Best-effort client identifier from proxy headers set by Vercel / reverse proxies. */
export function clientIdentifier(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || "anonymous";
}
