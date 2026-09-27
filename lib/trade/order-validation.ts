import { z } from "zod";

import {
  commissionFor,
  PAPER_EXECUTION_CONFIG,
  roundCents,
  simulatedFillPrice,
  type ExecutionConfig,
} from "@/lib/trade/execution";
import type { LedgerState, OrderRequest, RejectionReason } from "@/lib/trade/types";

/** Maximum units per paper order (fat-finger guard). */
export const MAX_ORDER_QUANTITY = 100_000;
/** Maximum orders stored per demo account (bounds demo storage). */
export const MAX_ORDERS_PER_ACCOUNT = 500;
/** Post-trade single-position weight above which the ticket shows a concentration warning. */
export const CONCENTRATION_WARNING_WEIGHT = 0.35;

/**
 * Transport-level schema (HTTP / Server Action input). Shape errors → 400. Business rules
 * (quantity, symbol, cash, position) are enforced by `validateOrder` and produce recorded
 * REJECTED orders (422) so the user sees exactly why an order did not execute.
 */
export const orderRequestSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required")
    .max(10, "Symbol is too long")
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z][A-Z.]{0,9}$/, "Symbol may contain letters and dots only")),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number({ error: "Quantity must be a number" }),
  type: z.literal("MARKET").default("MARKET"),
  clientOrderId: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "clientOrderId may contain letters, digits, _ and -")
    .optional(),
});

export type OrderRequestInput = z.input<typeof orderRequestSchema>;

export interface OrderEstimate {
  referencePrice: number;
  fillPrice: number;
  notional: number;
  fee: number;
  /** Signed cash movement if executed. */
  cashImpact: number;
  cashAfter: number;
  positionAfter: number;
  /** Post-trade weight of this symbol in total portfolio value. */
  weightAfter: number;
  warnings: string[];
}

export type OrderValidationResult =
  | { ok: true; estimate: OrderEstimate }
  | { ok: false; reason: RejectionReason; message: string; estimate: OrderEstimate | null };

export interface OrderValidationContext {
  ledger: LedgerState;
  knownSymbols: ReadonlySet<string>;
  /** Reference price for the order's symbol, or null when unavailable. */
  referencePrice: number | null;
  /** Current market value of all holdings (for concentration estimates). */
  holdingsMarketValue: number;
  /** Current market value of this symbol's holding. */
  symbolMarketValue: number;
  existingOrderCount: number;
  config?: ExecutionConfig;
}

export const REJECTION_MESSAGES: Record<RejectionReason, string> = {
  INVALID_QUANTITY: `Quantity must be a whole number between 1 and ${MAX_ORDER_QUANTITY.toLocaleString("en-US")}.`,
  UNKNOWN_SYMBOL: "Symbol is not in the tradable demo universe.",
  INSUFFICIENT_CASH: "Insufficient virtual cash to cover the order including commission.",
  INSUFFICIENT_POSITION: "Cannot sell more than the current position (short selling is disabled).",
  ORDER_LIMIT_REACHED: `Demo accounts are limited to ${MAX_ORDERS_PER_ACCOUNT} orders. Reset the account to continue.`,
};

function reject(
  reason: RejectionReason,
  estimate: OrderEstimate | null,
  detail?: string,
): OrderValidationResult {
  return {
    ok: false,
    reason,
    message: detail ? `${REJECTION_MESSAGES[reason]} ${detail}` : REJECTION_MESSAGES[reason],
    estimate,
  };
}

/** Pure business validation for a paper market order. Order of checks is deliberate. */
export function validateOrder(
  request: OrderRequest,
  context: OrderValidationContext,
): OrderValidationResult {
  const config = context.config ?? PAPER_EXECUTION_CONFIG;

  if (context.existingOrderCount >= MAX_ORDERS_PER_ACCOUNT) {
    return reject("ORDER_LIMIT_REACHED", null);
  }
  if (
    !Number.isFinite(request.quantity) ||
    !Number.isInteger(request.quantity) ||
    request.quantity < 1 ||
    request.quantity > MAX_ORDER_QUANTITY
  ) {
    return reject("INVALID_QUANTITY", null);
  }
  const symbol = request.symbol.trim().toUpperCase();
  if (!context.knownSymbols.has(symbol) || context.referencePrice === null) {
    return reject("UNKNOWN_SYMBOL", null, `Received "${symbol}".`);
  }

  const fillPrice = simulatedFillPrice(request.side, context.referencePrice, config);
  const notional = roundCents(fillPrice * request.quantity);
  const fee = commissionFor(notional, config);
  const cashImpact =
    request.side === "BUY" ? -roundCents(notional + fee) : roundCents(notional - fee);
  const held = context.ledger.holdings.get(symbol)?.quantity ?? 0;
  const positionAfter = request.side === "BUY" ? held + request.quantity : held - request.quantity;
  const cashAfter = roundCents(context.ledger.cash + cashImpact);

  // Post-trade concentration estimate at the reference price.
  const symbolValueAfter = Math.max(0, positionAfter) * context.referencePrice;
  const totalAfter =
    cashAfter + context.holdingsMarketValue - context.symbolMarketValue + symbolValueAfter;
  const weightAfter = totalAfter > 0 ? symbolValueAfter / totalAfter : 0;

  const warnings: string[] = [];
  if (request.side === "BUY" && weightAfter > CONCENTRATION_WARNING_WEIGHT) {
    warnings.push(
      `${symbol} would be ${(weightAfter * 100).toFixed(0)}% of the portfolio (concentration threshold ${(CONCENTRATION_WARNING_WEIGHT * 100).toFixed(0)}%).`,
    );
  }

  const estimate: OrderEstimate = {
    referencePrice: context.referencePrice,
    fillPrice,
    notional,
    fee,
    cashImpact,
    cashAfter,
    positionAfter,
    weightAfter,
    warnings,
  };

  if (request.side === "BUY" && notional + fee > context.ledger.cash + 1e-9) {
    return reject(
      "INSUFFICIENT_CASH",
      estimate,
      `Required ${(notional + fee).toFixed(2)}, available ${context.ledger.cash.toFixed(2)}.`,
    );
  }
  if (request.side === "SELL" && request.quantity > held) {
    return reject(
      "INSUFFICIENT_POSITION",
      estimate,
      `Held ${held}, requested ${request.quantity}.`,
    );
  }
  return { ok: true, estimate };
}
