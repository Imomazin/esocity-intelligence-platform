import { asc, eq, inArray } from "drizzle-orm";

import type { Database } from "@/db/client";
import {
  assets,
  paperAccounts,
  paperOrders,
  paperPositions,
  paperTransactions,
  users,
} from "@/db/schema";
import { replayLedger } from "@/lib/trade/ledger";
import type { AccountMutation, PaperTradingStore } from "@/lib/trade/store/types";
import type { PaperAccountRecord, PaperOrder } from "@/lib/trade/types";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

/**
 * PostgreSQL persistence. Each mutation runs in a transaction that locks the account row
 * (SELECT … FOR UPDATE), so concurrent orders for the same account are strictly serialised.
 * `paper_orders` is the ledger; `paper_positions`, `paper_transactions` and
 * `paper_accounts.cash` are maintained as queryable projections of it in the same transaction.
 */
export class PostgresPaperTradingStore implements PaperTradingStore {
  readonly kind = "postgres" as const;
  readonly durable = true;

  constructor(private readonly db: Database) {}

  private async read(
    executor: Executor,
    accountId: string,
    lock: boolean,
  ): Promise<PaperAccountRecord | null> {
    const query = executor.select().from(paperAccounts).where(eq(paperAccounts.id, accountId));
    const [account] = lock ? await query.for("update") : await query;
    if (!account) return null;
    const orderRows = await executor
      .select()
      .from(paperOrders)
      .where(eq(paperOrders.accountId, accountId))
      .orderBy(asc(paperOrders.requestedAt), asc(paperOrders.createdAt));
    return {
      id: account.id,
      ownerId: account.userId,
      name: account.name,
      baseCurrency: "USD",
      startingCash: account.startingCash,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
      orders: orderRows.map((row) => ({
        id: row.id,
        accountId: row.accountId,
        symbol: row.symbol,
        side: row.side,
        type: "MARKET",
        quantity: row.quantity,
        status: row.status === "FILLED" ? "FILLED" : "REJECTED",
        requestedAt: row.requestedAt.toISOString(),
        filledAt: row.filledAt?.toISOString() ?? null,
        referencePrice: row.referencePrice,
        fillPrice: row.fillPrice,
        fee: row.fee,
        notional: row.notional,
        cashImpact:
          row.status === "FILLED" && row.notional !== null
            ? row.side === "BUY"
              ? -(row.notional + row.fee)
              : row.notional - row.fee
            : 0,
        realizedPnl: null,
        rejectionReason: (row.rejectionReason as PaperOrder["rejectionReason"]) ?? null,
        rejectionMessage: row.rejectionMessage,
        source: row.clientOrderId?.startsWith("seed-") ? "seed" : "user",
        clientOrderId: row.clientOrderId,
      })),
    };
  }

  async load(accountId: string): Promise<PaperAccountRecord | null> {
    return this.read(this.db, accountId, false);
  }

  async mutate<T>(
    accountId: string,
    mutator: (current: PaperAccountRecord | null) => AccountMutation<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const current = await this.read(tx, accountId, true);
      const mutation = mutator(current);
      const { next } = mutation;
      const ledger = replayLedger(next.startingCash, next.orders);

      if (!current) {
        await tx
          .insert(users)
          .values({ id: next.ownerId, displayName: "Demo Analyst", role: "analyst", isDemo: true })
          .onConflictDoNothing({ target: users.id });
        await tx.insert(paperAccounts).values({
          id: next.id,
          userId: next.ownerId,
          name: next.name,
          baseCurrency: next.baseCurrency,
          startingCash: next.startingCash,
          cash: ledger.cash,
          createdAt: new Date(next.createdAt),
        });
      } else {
        if (mutation.reset) {
          await tx.delete(paperTransactions).where(eq(paperTransactions.accountId, accountId));
          await tx.delete(paperOrders).where(eq(paperOrders.accountId, accountId));
        }
        await tx
          .update(paperAccounts)
          .set({ cash: ledger.cash, startingCash: next.startingCash, updatedAt: new Date() })
          .where(eq(paperAccounts.id, accountId));
      }

      const appended = mutation.appended;
      if (appended.length > 0) {
        const symbols = [...new Set(next.orders.map((order) => order.symbol))];
        const assetRows = symbols.length
          ? await tx
              .select({ id: assets.id, symbol: assets.symbol })
              .from(assets)
              .where(inArray(assets.symbol, symbols))
          : [];
        const assetIds = new Map(assetRows.map((row) => [row.symbol, row.id]));

        await tx.insert(paperOrders).values(
          appended.map((order) => ({
            id: order.id,
            accountId: next.id,
            assetId: assetIds.get(order.symbol) ?? null,
            symbol: order.symbol,
            side: order.side,
            orderType: order.type,
            quantity: order.quantity,
            status: order.status,
            requestedAt: new Date(order.requestedAt),
            filledAt: order.filledAt ? new Date(order.filledAt) : null,
            referencePrice: order.referencePrice,
            fillPrice: order.fillPrice,
            fee: order.fee,
            notional: order.notional,
            rejectionReason: order.rejectionReason,
            rejectionMessage: order.rejectionMessage,
            clientOrderId: order.clientOrderId,
          })),
        );

        // Cash-flow projection for newly appended fills (plus the opening deposit).
        const priorOrders = next.orders.slice(0, next.orders.length - appended.length);
        let balance = replayLedger(next.startingCash, priorOrders).cash;
        const transactionRows: (typeof paperTransactions.$inferInsert)[] = [];
        if (!current || mutation.reset) {
          balance = next.startingCash;
          transactionRows.push({
            accountId: next.id,
            type: "DEPOSIT",
            amount: next.startingCash,
            balanceAfter: next.startingCash,
            description: "Virtual starting balance",
            occurredAt: new Date(next.createdAt),
          });
        }
        for (const order of appended) {
          if (order.status !== "FILLED" || order.fillPrice === null) continue;
          balance = Math.round((balance + order.cashImpact) * 100) / 100;
          transactionRows.push({
            accountId: next.id,
            orderId: order.id,
            type: order.side,
            amount: order.cashImpact,
            balanceAfter: balance,
            description: `${order.side === "BUY" ? "Bought" : "Sold"} ${order.quantity} ${order.symbol} @ ${order.fillPrice.toFixed(2)} (fee ${order.fee.toFixed(2)})`,
            occurredAt: new Date(order.filledAt ?? order.requestedAt),
          });
        }
        if (transactionRows.length) await tx.insert(paperTransactions).values(transactionRows);
      }

      // Positions projection: rebuild from the ledger.
      await tx.delete(paperPositions).where(eq(paperPositions.accountId, accountId));
      const holdings = [...ledger.holdings.values()];
      if (holdings.length) {
        const assetRows = await tx
          .select({ id: assets.id, symbol: assets.symbol })
          .from(assets)
          .where(
            inArray(
              assets.symbol,
              holdings.map((holding) => holding.symbol),
            ),
          );
        const assetIds = new Map(assetRows.map((row) => [row.symbol, row.id]));
        await tx.insert(paperPositions).values(
          holdings.map((holding) => ({
            accountId: next.id,
            assetId: assetIds.get(holding.symbol) ?? null,
            symbol: holding.symbol,
            quantity: holding.quantity,
            averageCost: holding.averageCost,
            realizedPnl: holding.realizedPnl,
            openedAt: new Date(holding.openedAt),
          })),
        );
      }

      return mutation.result;
    });
  }
}
