import type { RiskLevel } from "@/lib/risk-levels";

/** PAPER TRADING ONLY — no type in this module represents a real brokerage order. */

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET";
export type OrderStatus = "FILLED" | "REJECTED";

export type RejectionReason =
  | "INVALID_QUANTITY"
  | "UNKNOWN_SYMBOL"
  | "INSUFFICIENT_CASH"
  | "INSUFFICIENT_POSITION"
  | "ORDER_LIMIT_REACHED";

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  quantity: number;
  type?: OrderType;
  clientOrderId?: string;
}

export interface PaperOrder {
  id: string;
  accountId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  status: OrderStatus;
  requestedAt: string;
  filledAt: string | null;
  /** Mid/last price the order was evaluated against. */
  referencePrice: number | null;
  fillPrice: number | null;
  fee: number;
  /** fillPrice × quantity. */
  notional: number | null;
  /** Signed cash movement: −(notional + fee) for buys, +(notional − fee) for sells. */
  cashImpact: number;
  /** Realised P&L booked by a sell (average-cost method, net of the sell fee). */
  realizedPnl: number | null;
  rejectionReason: RejectionReason | null;
  rejectionMessage: string | null;
  source: "user" | "seed";
  clientOrderId: string | null;
}

export interface PaperAccountRecord {
  id: string;
  ownerId: string;
  name: string;
  baseCurrency: "USD";
  startingCash: number;
  createdAt: string;
  updatedAt: string;
  /** Chronological order ledger — the single source of truth for account state. */
  orders: PaperOrder[];
}

export interface Holding {
  symbol: string;
  quantity: number;
  /** Average cost per unit, including buy commissions. */
  averageCost: number;
  realizedPnl: number;
  openedAt: string;
}

export interface ClosedPosition {
  symbol: string;
  realizedPnl: number;
  quantityTraded: number;
  closedAt: string;
}

export interface LedgerState {
  cash: number;
  holdings: Map<string, Holding>;
  realizedPnl: number;
  feesPaid: number;
  closed: Map<string, ClosedPosition>;
}

export interface Position {
  symbol: string;
  name: string;
  quantity: number;
  averageCost: number;
  costBasis: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  dayChangePercent: number;
  realizedPnl: number;
  /** Share of total portfolio value. */
  weight: number;
  openedAt: string;
}

export interface ExposureSlice {
  symbol: string;
  label: string;
  marketValue: number;
  weight: number;
}

export interface PortfolioSummary {
  startingCash: number;
  cash: number;
  marketValue: number;
  totalValue: number;
  /** Cost basis of open positions. */
  investedCapital: number;
  unrealizedPnl: number;
  /** Unrealised P&L ÷ cost basis of open positions. */
  unrealizedReturn: number;
  realizedPnl: number;
  /** Total value − starting cash. */
  totalPnl: number;
  totalReturn: number;
  feesPaid: number;
  dayChange: number;
  dayChangePercent: number;
  cashWeight: number;
  grossExposure: number;
  largestPosition: { symbol: string; weight: number } | null;
  /** Herfindahl–Hirschman index of position weights (0–1). */
  herfindahlIndex: number;
}

export interface RiskFactor {
  key: "volatility" | "drawdown" | "concentration" | "exposure";
  label: string;
  value: number;
  display: string;
  points: number;
  maxPoints: number;
  threshold: string;
}

export interface PortfolioRisk {
  score: number;
  level: RiskLevel;
  volatility: number;
  maxDrawdown: number;
  concentration: number;
  grossExposure: number;
  factors: RiskFactor[];
  warnings: string[];
}

export interface PortfolioHistoryPoint {
  date: string;
  value: number;
  cash: number;
  drawdown: number;
}
