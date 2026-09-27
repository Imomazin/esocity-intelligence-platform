import type { BrokerAdapterId } from "@/lib/env";
import type { OrderEstimate } from "@/lib/trade/order-validation";
import type { OrderRequest, PaperAccountRecord, PaperOrder } from "@/lib/trade/types";

export interface PlaceOrderResult {
  order: PaperOrder;
  account: PaperAccountRecord;
  estimate: OrderEstimate | null;
}

export interface AccountOwner {
  accountId: string;
  ownerId: string;
}

/**
 * Broker adapter contract. The platform only ever talks to a broker through this interface.
 *
 * Phase 1 ships exactly one implementation — PaperBrokerAdapter — which simulates fills against
 * market data and never contacts a real venue. Live adapters (Alpaca, Interactive Brokers) are
 * documented placeholders; enabling any live adapter requires the controls listed in
 * docs/PAPER_TRADING.md → "Path to live execution" (compliance review, per-user authorisation,
 * credential vaulting, pre-trade risk limits, kill switch, reconciliation).
 */
export interface BrokerAdapter {
  readonly id: BrokerAdapterId;
  readonly mode: "paper" | "live";
  readonly displayName: string;

  getAccount(owner: AccountOwner): Promise<PaperAccountRecord | null>;
  placeOrder(owner: AccountOwner, request: OrderRequest): Promise<PlaceOrderResult>;
  resetAccount(owner: AccountOwner, mode: "demo" | "cash"): Promise<PaperAccountRecord>;
}
