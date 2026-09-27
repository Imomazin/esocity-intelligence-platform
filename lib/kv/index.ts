import { getServerEnv } from "@/lib/env";
import { MemoryKeyValueStore } from "@/lib/kv/memory-store";
import type { KeyValueStore } from "@/lib/kv/types";
import { UpstashKeyValueStore } from "@/lib/kv/upstash-store";

export { kvKey, type KeyValueStore } from "@/lib/kv/types";

const globalForKv = globalThis as unknown as { __esocityKv?: KeyValueStore };

/**
 * Process-wide key-value store: Upstash when UPSTASH_REDIS_REST_URL/TOKEN are configured,
 * otherwise in-memory. Cached on globalThis so dev hot-reloads keep state.
 */
export function getKeyValueStore(): KeyValueStore {
  if (!globalForKv.__esocityKv) {
    const env = getServerEnv();
    globalForKv.__esocityKv =
      env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
        ? new UpstashKeyValueStore({
            url: env.UPSTASH_REDIS_REST_URL,
            token: env.UPSTASH_REDIS_REST_TOKEN,
          })
        : new MemoryKeyValueStore();
  }
  return globalForKv.__esocityKv;
}

/** Test helper: swap the store implementation. */
export function setKeyValueStoreForTesting(store: KeyValueStore | undefined): void {
  globalForKv.__esocityKv = store;
}
