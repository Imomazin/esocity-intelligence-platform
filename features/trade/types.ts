import type { ExecutionConfig } from "@/lib/trade/execution";
import type {
  ClosedPosition,
  ExposureSlice,
  PaperOrder,
  PortfolioHistoryPoint,
  PortfolioRisk,
  PortfolioSummary,
  Position,
} from "@/lib/trade/types";

export interface StorageInfo {
  kind: "postgres" | "memory" | "upstash" | "preview";
  durable: boolean;
  warning: string | null;
}

export interface TradableQuote {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  session: string;
}

export interface PaperTradingView {
  mode: "preview" | "persisted";
  accountId: string | null;
  account: { name: string; createdAt: string; startingCash: number; baseCurrency: string };
  storage: StorageInfo;
  broker: { id: string; displayName: string; mode: "paper" | "live" };
  summary: PortfolioSummary;
  positions: Position[];
  closedPositions: ClosedPosition[];
  orders: PaperOrder[];
  exposure: ExposureSlice[];
  history: PortfolioHistoryPoint[];
  risk: PortfolioRisk;
  quotes: TradableQuote[];
  execution: ExecutionConfig;
  limits: { maxQuantity: number; maxOrders: number; concentrationWarning: number };
}

export type ActionResult<T> =
  | { ok: true; message: string; data: T }
  | {
      ok: false;
      code: string;
      error: string;
      data?: T;
      issues?: { path: string; message: string }[];
    };
