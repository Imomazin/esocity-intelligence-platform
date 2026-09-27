import type { OrderSide } from "@/lib/trade/types";

/**
 * Simulated execution model for PAPER orders.
 *
 *   fill price = reference × (1 + slippage) for buys, × (1 − slippage) for sells
 *   commission = max(minimum, notional × commission rate)
 *
 * Deliberately conservative so paper results are not flattered by frictionless fills.
 */
export interface ExecutionConfig {
  commissionBps: number;
  minimumCommission: number;
  slippageBps: number;
}

export const PAPER_EXECUTION_CONFIG: ExecutionConfig = {
  commissionBps: 5,
  minimumCommission: 1,
  slippageBps: 5,
};

export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function simulatedFillPrice(
  side: OrderSide,
  referencePrice: number,
  config: ExecutionConfig = PAPER_EXECUTION_CONFIG,
): number {
  const slippage = config.slippageBps / 10_000;
  return roundCents(
    side === "BUY" ? referencePrice * (1 + slippage) : referencePrice * (1 - slippage),
  );
}

export function commissionFor(
  notional: number,
  config: ExecutionConfig = PAPER_EXECUTION_CONFIG,
): number {
  return roundCents(Math.max(config.minimumCommission, (notional * config.commissionBps) / 10_000));
}
