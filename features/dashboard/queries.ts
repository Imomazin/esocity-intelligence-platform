import "server-only";

import { getMarketOverview, getUniverseAnalysis } from "@/features/markets/queries";
import type { MarketOverview } from "@/features/markets/types";
import { getSportsOverview } from "@/features/sports/queries";
import type { MatchSummary, SportsOverview } from "@/features/sports/types";
import { getPaperTradingView } from "@/features/trade/queries";
import type { PaperTradingView } from "@/features/trade/types";
import { formatCurrency, formatProbability } from "@/lib/format";
import type { TradeSignal } from "@/lib/markets/types";

export interface RecentSignal {
  symbol: string;
  name: string;
  date: string;
  from: TradeSignal | null;
  to: TradeSignal;
  score: number;
  price: number;
  returnSince: number;
}

export interface ActivityItem {
  id: string;
  kind: "order" | "signal" | "match";
  title: string;
  detail: string;
  at: string;
  href: string;
  tone: "positive" | "negative" | "neutral";
}

export interface DashboardView {
  market: MarketOverview;
  sports: SportsOverview;
  paper: PaperTradingView;
  recentSignals: RecentSignal[];
  upcomingMatches: MatchSummary[];
  activity: ActivityItem[];
}

export async function getDashboardView(): Promise<DashboardView> {
  const [market, universe, sports, paper] = await Promise.all([
    getMarketOverview(),
    getUniverseAnalysis(),
    getSportsOverview({ upcomingDays: 7 }),
    getPaperTradingView(),
  ]);

  const recentSignals: RecentSignal[] = universe.assets
    .flatMap((asset) =>
      asset.signalHistory.slice(0, 2).map((change) => ({
        symbol: asset.profile.symbol,
        name: asset.profile.name,
        ...change,
      })),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);

  const activity: ActivityItem[] = [
    ...paper.orders.slice(0, 5).map<ActivityItem>((order) => ({
      id: `order-${order.id}`,
      kind: "order",
      title:
        order.status === "FILLED"
          ? `${order.side === "BUY" ? "Bought" : "Sold"} ${order.quantity} ${order.symbol}`
          : `Order rejected · ${order.symbol}`,
      detail:
        order.status === "FILLED" && order.fillPrice !== null
          ? `Paper fill at ${formatCurrency(order.fillPrice)}`
          : (order.rejectionMessage ?? "Rejected"),
      at: order.filledAt ?? order.requestedAt,
      href: "/trade",
      tone: order.status === "FILLED" ? "neutral" : "negative",
    })),
    ...recentSignals.slice(0, 4).map<ActivityItem>((signal) => ({
      id: `signal-${signal.symbol}-${signal.date}`,
      kind: "signal",
      title: `${signal.symbol} → ${signal.to}`,
      detail: `Signal changed from ${signal.from ?? "—"} (score ${signal.score >= 0 ? "+" : "−"}${Math.abs(signal.score).toFixed(2)})`,
      at: `${signal.date}T21:00:00.000Z`,
      href: `/markets/${signal.symbol}`,
      tone: signal.to === "BUY" ? "positive" : signal.to === "SELL" ? "negative" : "neutral",
    })),
    ...sports.recent.slice(0, 4).map<ActivityItem>((match) => ({
      id: `match-${match.id}`,
      kind: "match",
      title: `${match.home.shortName} ${match.score?.home ?? "–"}–${match.score?.away ?? "–"} ${match.away.shortName}`,
      detail: `${match.outcomeCorrect ? "Model's most likely outcome occurred" : "Outcome differed from the model's most likely"} (H ${formatProbability(match.prediction.home)} · D ${formatProbability(match.prediction.draw)} · A ${formatProbability(match.prediction.away)})`,
      at: match.kickoffAt,
      href: `/sports/match/${match.id}`,
      tone: match.outcomeCorrect ? "positive" : "neutral",
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10);

  return {
    market,
    sports,
    paper,
    recentSignals,
    upcomingMatches: sports.upcoming.slice(0, 6),
    activity,
  };
}
