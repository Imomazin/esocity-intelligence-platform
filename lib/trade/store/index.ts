import { getDb } from "@/db/client";
import { getServerEnv } from "@/lib/env";
import { getKeyValueStore } from "@/lib/kv";
import { KeyValuePaperTradingStore } from "@/lib/trade/store/kv-store";
import { PostgresPaperTradingStore } from "@/lib/trade/store/postgres-store";
import type { PaperTradingStore } from "@/lib/trade/store/types";

export type { PaperTradingStore } from "@/lib/trade/store/types";

const globalForStore = globalThis as unknown as {
  __esocityPaperStore?: PaperTradingStore;
  __esocityFallbackPaperStore?: PaperTradingStore;
};

/**
 * Primary paper-trading store: PostgreSQL when DATABASE_URL is configured, otherwise the
 * key-value store (Upstash or in-memory).
 */
export function getPaperTradingStore(): PaperTradingStore {
  if (!globalForStore.__esocityPaperStore) {
    globalForStore.__esocityPaperStore = getServerEnv().DATABASE_URL
      ? new PostgresPaperTradingStore(getDb())
      : new KeyValuePaperTradingStore(getKeyValueStore());
  }
  return globalForStore.__esocityPaperStore;
}

/** Demo-mode fallback used (with a visible warning) if the database is unreachable. */
export function getFallbackPaperTradingStore(): PaperTradingStore {
  globalForStore.__esocityFallbackPaperStore ??= new KeyValuePaperTradingStore(getKeyValueStore());
  return globalForStore.__esocityFallbackPaperStore;
}

/** Test helper. */
export function setPaperTradingStoreForTesting(store: PaperTradingStore | undefined): void {
  globalForStore.__esocityPaperStore = store;
}
