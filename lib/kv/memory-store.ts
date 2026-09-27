import type { KeyValueStore } from "@/lib/kv/types";

interface Entry {
  value: unknown;
  expiresAt: number | null;
}

/**
 * In-process key-value store with TTLs and a bounded size (oldest entries evicted first).
 *
 * State is per server instance: on Vercel it survives warm invocations but not cold starts or
 * cross-instance routing. That is acceptable for demo mode; configure Upstash or PostgreSQL for
 * durable state (see docs/PAPER_TRADING.md).
 */
export class MemoryKeyValueStore implements KeyValueStore {
  readonly kind = "memory" as const;
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxEntries = 5_000,
    private readonly clock: () => number = Date.now,
  ) {}

  private read(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private write(key: string, entry: Entry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.read(key);
    // Structured clone keeps callers from mutating stored state by reference.
    return entry ? (structuredClone(entry.value) as T) : null;
  }

  async set<T>(key: string, value: T, options: { ttlSeconds?: number } = {}): Promise<void> {
    this.write(key, {
      value: structuredClone(value),
      expiresAt: options.ttlSeconds ? this.clock() + options.ttlSeconds * 1000 : null,
    });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const entry = this.read(key);
    const next = (typeof entry?.value === "number" ? entry.value : 0) + 1;
    this.write(key, {
      value: next,
      expiresAt: entry?.expiresAt ?? this.clock() + ttlSeconds * 1000,
    });
    return next;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.read(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.max(0, Math.ceil((entry.expiresAt - this.clock()) / 1000));
  }

  async ping(): Promise<boolean> {
    return true;
  }
}
