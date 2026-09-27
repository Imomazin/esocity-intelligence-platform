import { kvKey, type KeyValueStore } from "@/lib/kv";
import type { AccountMutation, PaperTradingStore } from "@/lib/trade/store/types";
import type { PaperAccountRecord } from "@/lib/trade/types";

const ACCOUNT_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Paper accounts stored as one JSON document per account in the key-value store (Upstash in
 * production-like demos, memory otherwise). Mutations are serialised per account within this
 * process. Upstash's REST API has no cross-instance transactions, so two instances mutating the
 * same demo account at the same instant resolve last-write-wins — acceptable for demo data and
 * documented; use PostgreSQL for strict consistency.
 */
export class KeyValuePaperTradingStore implements PaperTradingStore {
  readonly kind: "memory" | "upstash";
  readonly durable: boolean;
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly kv: KeyValueStore) {
    this.kind = kv.kind;
    this.durable = kv.kind === "upstash";
  }

  private key(accountId: string): string {
    return kvKey("paper", "account", accountId);
  }

  async load(accountId: string): Promise<PaperAccountRecord | null> {
    return this.kv.get<PaperAccountRecord>(this.key(accountId));
  }

  private async exclusive<T>(accountId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(accountId) ?? Promise.resolve();
    const run = previous.then(task);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(accountId, tail);
    try {
      return await run;
    } finally {
      if (this.chains.get(accountId) === tail) this.chains.delete(accountId);
    }
  }

  async mutate<T>(
    accountId: string,
    mutator: (current: PaperAccountRecord | null) => AccountMutation<T>,
  ): Promise<T> {
    return this.exclusive(accountId, async () => {
      const current = await this.load(accountId);
      const mutation = mutator(current);
      await this.kv.set(this.key(accountId), mutation.next, { ttlSeconds: ACCOUNT_TTL_SECONDS });
      return mutation.result;
    });
  }
}
