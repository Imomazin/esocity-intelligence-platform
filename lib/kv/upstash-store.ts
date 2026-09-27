import { Redis } from "@upstash/redis";

import type { KeyValueStore } from "@/lib/kv/types";

/** Upstash Redis (REST) implementation. Values are JSON-serialised by the Upstash client. */
export class UpstashKeyValueStore implements KeyValueStore {
  readonly kind = "upstash" as const;
  private readonly redis: Redis;

  constructor(config: { url: string; token: string }) {
    this.redis = new Redis({
      url: config.url,
      token: config.token,
      // Fail fast; callers decide how to degrade.
      retry: { retries: 1, backoff: () => 100 },
      enableTelemetry: false,
    });
  }

  async get<T>(key: string): Promise<T | null> {
    return (await this.redis.get<T>(key)) ?? null;
  }

  async set<T>(key: string, value: T, options: { ttlSeconds?: number } = {}): Promise<void> {
    if (options.ttlSeconds) {
      await this.redis.set(key, value, { ex: options.ttlSeconds });
    } else {
      await this.redis.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const pipeline = this.redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, ttlSeconds, "NX");
    const [count] = await pipeline.exec<[number, number]>();
    return count;
  }

  async ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }

  async ping(): Promise<boolean> {
    return (await this.redis.ping()) === "PONG";
  }
}
