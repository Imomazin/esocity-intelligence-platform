import type { PaperAccountRecord, PaperOrder } from "@/lib/trade/types";

export interface AccountMutation<T> {
  /** The account after the mutation. */
  next: PaperAccountRecord;
  /** Orders added by this mutation (all orders when `created` or `reset`). */
  appended: PaperOrder[];
  /** True when the account did not exist before this mutation. */
  created: boolean;
  /** True when the ledger was replaced (account reset). */
  reset: boolean;
  result: T;
}

/**
 * Persistence for paper accounts. Implementations MUST serialise concurrent mutations of the
 * same account so validation (cash, position) always runs against the latest state.
 */
export interface PaperTradingStore {
  readonly kind: "postgres" | "memory" | "upstash";
  /** False for per-instance memory storage (state can reset on serverless cold starts). */
  readonly durable: boolean;
  load(accountId: string): Promise<PaperAccountRecord | null>;
  mutate<T>(
    accountId: string,
    mutator: (current: PaperAccountRecord | null) => AccountMutation<T>,
  ): Promise<T>;
}
