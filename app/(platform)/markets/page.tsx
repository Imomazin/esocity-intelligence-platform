import { Gauge, Scale, Target, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DataSourceNote, Disclaimer } from "@/components/data/disclaimer";
import { SectionCard } from "@/components/data/section-card";
import { StatCard } from "@/components/data/stat-card";
import { Delta } from "@/components/data/delta";
import { RegimeBadge } from "@/components/indicators/badges";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { AssetCard } from "@/features/markets/components/asset-card";
import { AssetTable } from "@/features/markets/components/asset-table";
import { Movers } from "@/features/markets/components/movers";
import { getMarketOverview } from "@/features/markets/queries";
import { WatchlistCompact } from "@/features/watchlist/components/watchlist";
import { formatCurrency, formatDate, formatPercent, formatSignedNumber } from "@/lib/format";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Markets",
  description: "Composite market signals, regimes and risk across the Esocity universe.",
};

export const revalidate = 300;

const SESSION_LABEL = {
  open: "US market open",
  "pre-market": "Pre-market",
  closed: "US market closed",
} as const;

export default async function MarketsPage() {
  const overview = await getMarketOverview();
  const { breadth, benchmark, evaluation } = overview;
  const tone =
    breadth.averageScore > 0.15 ? "Risk-on" : breadth.averageScore < -0.15 ? "Risk-off" : "Mixed";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Esocity Markets"
        title="Market intelligence"
        description="Composite, explainable signals across the tracked universe — trend, momentum, RSI, volatility and regime, calibrated into probabilities."
        meta={
          <>
            <DataSourceNote
              simulated={overview.provider.isSimulated}
              source={overview.provider.displayName}
              asOf={`Daily bars through ${formatDate(overview.asOf)}`}
            />
            <span aria-hidden>·</span>
            <span>{SESSION_LABEL[overview.session.status]}</span>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Market tone"
          icon={<Gauge />}
          value={tone}
          footnote={`Average composite ${formatSignedNumber(breadth.averageScore, 2)}`}
        />
        <StatCard
          label="Breadth (above 50-day)"
          icon={<TrendingUp />}
          value={`${breadth.aboveSma50} of ${breadth.assets}`}
          footnote={`${breadth.advancing} advancing · ${breadth.declining} declining`}
        />
        <StatCard
          label="Benchmark (SPY)"
          icon={<Scale />}
          value={benchmark ? formatCurrency(benchmark.price) : "—"}
          delta={benchmark ? <Delta value={benchmark.changePercent} /> : undefined}
          footnote={
            benchmark ? <RegimeBadge regime={benchmark.regime} className="py-0" /> : undefined
          }
        />
        <StatCard
          label="Signal hit rate (walk-forward)"
          icon={<Target />}
          value={
            evaluation.directionalHitRate === null
              ? "—"
              : formatPercent(evaluation.directionalHitRate, 1)
          }
          footnote={`${evaluation.directionalCalls.toLocaleString("en-US")} calls · ${overview.horizonDays}-day horizon`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {overview.assets.map((asset) => (
          <AssetCard key={asset.symbol} asset={asset} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <SectionCard
          title="Universe"
          description={`Signals: ${breadth.signalCounts.BUY} BUY · ${breadth.signalCounts.HOLD} HOLD · ${breadth.signalCounts.SELL} SELL`}
          contentClassName="px-0"
        >
          <AssetTable assets={overview.assets} caption="Universe with prices, signals and risk" />
        </SectionCard>
        <div className="space-y-4">
          <SectionCard title="Market movers" description="Change vs previous close">
            <Movers gainers={overview.gainers} losers={overview.losers} />
          </SectionCard>
          <SectionCard
            title="Watchlist"
            action={
              <Button variant="link" size="sm" className="h-auto p-0" asChild>
                <Link href="/watchlist">Manage</Link>
              </Button>
            }
          >
            <WatchlistCompact assets={overview.assets} limit={5} />
          </SectionCard>
        </div>
      </div>

      <Disclaimer>
        {siteConfig.financialDisclaimer}{" "}
        {overview.provider.isSimulated
          ? "Prices shown are simulated demo data."
          : `Prices: ${overview.provider.displayName} (delayed, not real-time).`}
      </Disclaimer>
    </div>
  );
}
