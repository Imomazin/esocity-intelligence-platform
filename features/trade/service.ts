import "server-only";

import type { PaperTradingView, StorageInfo } from "@/features/trade/types";
import { recordAuditEvent } from "@/lib/audit";
import { DEMO_PREVIEW_USER_ID } from "@/lib/auth/demo";
import { getServerEnv } from "@/lib/env";
import { formatCurrency } from "@/lib/format";
import { logger } from "@/lib/logger";
import { getMarketDataProvider } from "@/lib/markets/providers";
import { getBrokerAdapter, type AccountOwner, type PlaceOrderResult } from "@/lib/trade/brokers";
import { buildDemoAccount } from "@/lib/trade/demo-portfolio";
import { PAPER_EXECUTION_CONFIG } from "@/lib/trade/execution";
import { annotateRealizedPnl, replayLedger } from "@/lib/trade/ledger";
import {
  CONCENTRATION_WARNING_WEIGHT,
  MAX_ORDER_QUANTITY,
  MAX_ORDERS_PER_ACCOUNT,
} from "@/lib/trade/order-validation";
import {
  buildClosedPositions,
  buildPortfolioHistory,
  estimatePortfolioVolatility,
  historyMaxDrawdown,
  summarisePortfolio,
  type PriceSnapshot,
} from "@/lib/trade/portfolio";
import { assessPortfolioRisk } from "@/lib/trade/risk";
import {
  getFallbackPaperTradingStore,
  getPaperTradingStore,
  type PaperTradingStore,
} from "@/lib/trade/store";
import type { OrderRequest, PaperAccountRecord } from "@/lib/trade/types";

const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "EAI_AGAIN",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
]);

function isConnectionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && CONNECTION_ERROR_CODES.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function storageInfo(store: PaperTradingStore, warning: string | null = null): StorageInfo {
  const volatileWarning =
    store.kind === "memory"
      ? "Demo storage is in-memory on this server instance and may reset. Configure PostgreSQL or Upstash Redis for persistence."
      : null;
  return { kind: store.kind, durable: store.durable, warning: warning ?? volatileWarning };
}

/**
 * Run an operation against the primary store. In DEMO MODE only, a database connection failure
 * falls back to the key-value store with a visible warning and an error log. In production mode
 * database errors always propagate.
 */
export async function withPaperStore<T>(
  operation: (store: PaperTradingStore) => Promise<T>,
): Promise<{ value: T; storage: StorageInfo }> {
  const primary = getPaperTradingStore();
  try {
    return { value: await operation(primary), storage: storageInfo(primary) };
  } catch (error) {
    if (primary.kind === "postgres" && getServerEnv().DEMO_MODE && isConnectionError(error)) {
      logger.error("paper_store.database_unavailable", { error });
      const fallback = getFallbackPaperTradingStore();
      return {
        value: await operation(fallback),
        storage: storageInfo(
          fallback,
          "PostgreSQL is unreachable — using temporary demo storage. Orders placed now will not be saved to the database.",
        ),
      };
    }
    throw error;
  }
}

export interface OrderContextMeta {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/** Place a paper order and record the audit event. Shared by the Server Action and REST API. */
export async function executePaperOrder(
  owner: AccountOwner,
  request: OrderRequest,
  meta: OrderContextMeta = {},
): Promise<PlaceOrderResult & { storage: StorageInfo; message: string }> {
  const { value: result, storage } = await withPaperStore((store) =>
    getBrokerAdapter(store).placeOrder(owner, request),
  );
  const { order } = result;
  await recordAuditEvent({
    action: order.status === "FILLED" ? "paper_order.filled" : "paper_order.rejected",
    actorType: "demo",
    actorId: owner.ownerId,
    resourceType: "paper_order",
    resourceId: order.id,
    outcome: order.status === "FILLED" ? "success" : "failure",
    requestId: meta.requestId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      accountId: owner.accountId,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      fillPrice: order.fillPrice,
      fee: order.fee,
      rejectionReason: order.rejectionReason,
    },
  });
  const message =
    order.status === "FILLED" && order.fillPrice !== null
      ? `${order.side === "BUY" ? "Bought" : "Sold"} ${order.quantity} ${order.symbol} at ${formatCurrency(order.fillPrice)} (paper).`
      : (order.rejectionMessage ?? "Order rejected.");
  return { ...result, storage, message };
}

export async function resetPaperAccount(
  owner: AccountOwner,
  mode: "demo" | "cash",
  meta: OrderContextMeta = {},
): Promise<{ account: PaperAccountRecord; storage: StorageInfo }> {
  const { value: account, storage } = await withPaperStore((store) =>
    getBrokerAdapter(store).resetAccount(owner, mode),
  );
  await recordAuditEvent({
    action: "paper_account.reset",
    actorType: "demo",
    actorId: owner.ownerId,
    resourceType: "paper_account",
    resourceId: owner.accountId,
    outcome: "success",
    requestId: meta.requestId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { mode },
  });
  return { account, storage };
}

/** Load the account for a session, or null when it has never been written. */
export async function loadPaperAccount(
  accountId: string,
): Promise<{ account: PaperAccountRecord | null; storage: StorageInfo }> {
  const { value, storage } = await withPaperStore((store) => store.load(accountId));
  return { account: value, storage };
}

/** Seeded demo account computed on the fly (read-only preview before the first order). */
export async function buildPreviewAccount(accountId: string | null): Promise<PaperAccountRecord> {
  const provider = getMarketDataProvider();
  const session = provider.getSession();
  const assets = await provider.listAssets();
  const barsBySymbol = new Map(
    await Promise.all(
      assets.map(
        async (asset) =>
          [asset.symbol, await provider.getDailyBars(asset.symbol, { limit: 320 })] as const,
      ),
    ),
  );
  const id = accountId ?? DEMO_PREVIEW_USER_ID;
  return buildDemoAccount({
    accountId: id,
    ownerId: id,
    lastCompletedDate: session.lastCompletedDate,
    barsBySymbol,
  });
}

/** Full analytical view of a paper account at current (simulated) prices. */
export async function buildPaperTradingView(
  account: PaperAccountRecord,
  options: { mode: PaperTradingView["mode"]; storage: StorageInfo },
): Promise<PaperTradingView> {
  const provider = getMarketDataProvider();
  const session = provider.getSession();
  const assets = await provider.listAssets();
  const [quotes, barsEntries] = await Promise.all([
    Promise.all(assets.map((asset) => provider.getQuote(asset.symbol))),
    Promise.all(
      assets.map(
        async (asset) =>
          [asset.symbol, await provider.getDailyBars(asset.symbol, { limit: 320 })] as const,
      ),
    ),
  ]);
  const barsBySymbol = new Map(barsEntries);
  const names = new Map(assets.map((asset) => [asset.symbol, asset.name]));
  const prices = new Map<string, PriceSnapshot>(
    quotes.map((quote) => [
      quote.symbol,
      { price: quote.price, previousClose: quote.previousClose, name: names.get(quote.symbol) },
    ]),
  );

  const ledger = replayLedger(account.startingCash, account.orders);
  const { summary, positions, exposure } = summarisePortfolio(account, ledger, prices);
  const history = buildPortfolioHistory(account, barsBySymbol, {
    from: account.createdAt.slice(0, 10),
    to: session.lastCompletedDate,
  });
  // Append today's intraday mark so the chart ends at the live value.
  if (history.length === 0 || history[history.length - 1]?.date !== session.sessionDate) {
    const peak = Math.max(summary.totalValue, ...history.map((point) => point.value));
    history.push({
      date: session.status === "open" ? session.sessionDate : session.lastCompletedDate,
      value: summary.totalValue,
      cash: summary.cash,
      drawdown: peak > 0 ? summary.totalValue / peak - 1 : 0,
    });
  }
  const dedupedHistory = history.filter(
    (point, index) => index === history.length - 1 || point.date !== history[index + 1]?.date,
  );
  const volatility = estimatePortfolioVolatility(positions, summary.totalValue, barsBySymbol);
  const maxDrawdown = historyMaxDrawdown(dedupedHistory);
  const broker = getBrokerAdapter(getPaperTradingStore());

  return {
    mode: options.mode,
    accountId: options.mode === "persisted" ? account.id : null,
    account: {
      name: account.name,
      createdAt: account.createdAt,
      startingCash: account.startingCash,
      baseCurrency: account.baseCurrency,
    },
    storage: options.storage,
    broker: { id: broker.id, displayName: broker.displayName, mode: broker.mode },
    summary,
    positions,
    closedPositions: buildClosedPositions(ledger),
    orders: annotateRealizedPnl(account.startingCash, account.orders).reverse(),
    exposure,
    history: dedupedHistory,
    risk: assessPortfolioRisk({ summary, volatility, maxDrawdown }),
    quotes: quotes.map((quote) => ({
      symbol: quote.symbol,
      name: names.get(quote.symbol) ?? quote.symbol,
      price: quote.price,
      changePercent: quote.changePercent,
      session: quote.session,
    })),
    execution: PAPER_EXECUTION_CONFIG,
    limits: {
      maxQuantity: MAX_ORDER_QUANTITY,
      maxOrders: MAX_ORDERS_PER_ACCOUNT,
      concentrationWarning: CONCENTRATION_WARNING_WEIGHT,
    },
  };
}

/** Resolve the view for a (possibly anonymous) demo session. */
export async function getPaperTradingViewForAccount(
  accountId: string | null,
): Promise<PaperTradingView> {
  if (accountId) {
    const { account, storage } = await loadPaperAccount(accountId);
    if (account) return buildPaperTradingView(account, { mode: "persisted", storage });
    return buildPaperTradingView(await buildPreviewAccount(accountId), {
      mode: "preview",
      storage,
    });
  }
  return buildPaperTradingView(await buildPreviewAccount(null), {
    mode: "preview",
    storage: { kind: "preview", durable: false, warning: null },
  });
}
