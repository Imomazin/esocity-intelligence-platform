import { roundCents } from "@/lib/trade/execution";
import type { LedgerState, PaperOrder } from "@/lib/trade/types";

/**
 * Event-sourced account state. Positions, cash and realised P&L are never stored as mutable
 * truth — they are derived by replaying the order ledger, which makes every number auditable.
 * Accounting: average-cost method; buy commissions are capitalised into cost basis; sell
 * commissions reduce proceeds (and therefore realised P&L).
 */

const QUANTITY_EPSILON = 1e-9;

export function emptyLedgerState(startingCash: number): LedgerState {
  return {
    cash: startingCash,
    holdings: new Map(),
    realizedPnl: 0,
    feesPaid: 0,
    closed: new Map(),
  };
}

/** Apply one FILLED order to a ledger state (mutates and returns `state`). */
export function applyFill(state: LedgerState, order: PaperOrder): LedgerState {
  if (order.status !== "FILLED" || order.fillPrice === null) return state;
  const notional = order.fillPrice * order.quantity;
  state.feesPaid = roundCents(state.feesPaid + order.fee);

  if (order.side === "BUY") {
    const existing = state.holdings.get(order.symbol);
    const previousQuantity = existing?.quantity ?? 0;
    const previousCost = (existing?.averageCost ?? 0) * previousQuantity;
    const quantity = previousQuantity + order.quantity;
    state.holdings.set(order.symbol, {
      symbol: order.symbol,
      quantity,
      averageCost: (previousCost + notional + order.fee) / quantity,
      realizedPnl: existing?.realizedPnl ?? 0,
      openedAt: existing?.openedAt ?? order.filledAt ?? order.requestedAt,
    });
    state.cash = roundCents(state.cash - notional - order.fee);
    state.closed.delete(order.symbol);
    return state;
  }

  const holding = state.holdings.get(order.symbol);
  if (!holding) return state; // validation prevents this; replay stays total
  const proceeds = notional - order.fee;
  const realized = proceeds - holding.averageCost * order.quantity;
  const remaining = holding.quantity - order.quantity;
  state.cash = roundCents(state.cash + proceeds);
  state.realizedPnl = roundCents(state.realizedPnl + realized);
  const symbolRealized = roundCents(holding.realizedPnl + realized);

  if (remaining <= QUANTITY_EPSILON) {
    state.holdings.delete(order.symbol);
    const previousClosed = state.closed.get(order.symbol);
    state.closed.set(order.symbol, {
      symbol: order.symbol,
      realizedPnl: roundCents((previousClosed?.realizedPnl ?? 0) + symbolRealized),
      quantityTraded: (previousClosed?.quantityTraded ?? 0) + order.quantity,
      closedAt: order.filledAt ?? order.requestedAt,
    });
  } else {
    state.holdings.set(order.symbol, {
      ...holding,
      quantity: remaining,
      realizedPnl: symbolRealized,
    });
  }
  return state;
}

/** Replay a chronological ledger. Rejected orders have no financial effect. */
export function replayLedger(startingCash: number, orders: readonly PaperOrder[]): LedgerState {
  const state = emptyLedgerState(startingCash);
  for (const order of orders) applyFill(state, order);
  return state;
}

/** Replay only orders executed on or before `isoDate` (inclusive, by filled date). */
export function replayLedgerThrough(
  startingCash: number,
  orders: readonly PaperOrder[],
  isoDate: string,
): LedgerState {
  return replayLedger(
    startingCash,
    orders.filter((order) => (order.filledAt ?? order.requestedAt).slice(0, 10) <= isoDate),
  );
}

/** Return a copy of the ledger with realised P&L populated on every filled SELL. */
export function annotateRealizedPnl(
  startingCash: number,
  orders: readonly PaperOrder[],
): PaperOrder[] {
  const state = emptyLedgerState(startingCash);
  return orders.map((order) => {
    const before = state.realizedPnl;
    applyFill(state, order);
    return order.status === "FILLED" && order.side === "SELL"
      ? { ...order, realizedPnl: roundCents(state.realizedPnl - before) }
      : { ...order };
  });
}
