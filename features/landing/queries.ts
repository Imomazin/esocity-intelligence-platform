import "server-only";

import { getMarketOverview } from "@/features/markets/queries";
import type { AssetSummary, MarketOverview } from "@/features/markets/types";
import { getDataSources, type DataSources } from "@/features/platform/data-sources";
import { getSportsOverview } from "@/features/sports/queries";
import type { MatchSummary, SportsOverview } from "@/features/sports/types";
import { getPaperTradingViewForAccount } from "@/features/trade/service";
import type { PaperTradingView } from "@/features/trade/types";
import { logger } from "@/lib/logger";
import { rethrowControlFlow } from "@/lib/request-time";

export interface LandingPreview {
  asOf: string;
  featuredAsset: AssetSummary | null;
  assets: AssetSummary[];
  marketEvaluation: MarketOverview["evaluation"];
  breadth: MarketOverview["breadth"];
  featuredMatch: MatchSummary | null;
  sportsEvaluation: SportsOverview["evaluation"];
  paper: Pick<PaperTradingView, "summary" | "risk" | "positions">;
  sources: DataSources;
}

/**
 * Live engine output for the public landing page. No cookies or per-visitor state are read, so
 * with the demo providers the page stays statically cacheable (ISR). Returns null when the data
 * cannot be loaded (e.g. licensed data not ingested yet): the public page must still render.
 */
export async function getLandingPreview(): Promise<LandingPreview | null> {
  try {
    return await buildLandingPreview();
  } catch (error) {
    rethrowControlFlow(error);
    logger.error("landing.preview_unavailable", { error });
    return null;
  }
}

async function buildLandingPreview(): Promise<LandingPreview> {
  const [market, sports, paper] = await Promise.all([
    getMarketOverview(),
    getSportsOverview({ upcomingDays: 10 }),
    getPaperTradingViewForAccount(null),
  ]);

  const byConviction = [...market.assets].sort((a, b) => b.confidence - a.confidence);
  const featuredAsset =
    byConviction.find((asset) => asset.signal !== "HOLD" && asset.symbol !== "SPY") ??
    byConviction[0] ??
    null;
  // Feature the clearest upcoming fixture: highest single-outcome probability.
  const featuredMatch =
    [...sports.upcoming].sort(
      (a, b) =>
        Math.max(b.prediction.home, b.prediction.away) -
        Math.max(a.prediction.home, a.prediction.away),
    )[0] ?? null;

  return {
    asOf: market.asOf,
    featuredAsset,
    assets: byConviction.slice(0, 5),
    marketEvaluation: market.evaluation,
    breadth: market.breadth,
    featuredMatch,
    sportsEvaluation: sports.evaluation,
    paper: { summary: paper.summary, risk: paper.risk, positions: paper.positions },
    sources: getDataSources(),
  };
}
