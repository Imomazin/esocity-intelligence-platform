/**
 * Redis-compatible key-value abstraction.
 *
 * Production on Vercel: Upstash Redis (HTTP/REST — no persistent TCP connections, which suits
 * serverless). Local development: the docker-compose stack runs Redis plus an Upstash-compatible
 * REST proxy. Demo mode with nothing configured: a per-instance in-memory store.
 */
export interface KeyValueStore {
  readonly kind: "memory" | "upstash";
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: { ttlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  /** Atomically increment a counter; sets the TTL when the key is created. */
  increment(key: string, ttlSeconds: number): Promise<number>;
  /** Remaining TTL in seconds (−1 when no expiry, −2 when missing). */
  ttl(key: string): Promise<number>;
  ping(): Promise<boolean>;
}

/** Namespaced key builder so every consumer shares one convention. */
export function kvKey(...parts: (string | number)[]): string {
  return ["esocity", ...parts].join(":");
}
