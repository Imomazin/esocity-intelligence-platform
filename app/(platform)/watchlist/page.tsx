import type { Metadata } from "next";

import { Disclaimer } from "@/components/data/disclaimer";
import { SectionCard } from "@/components/data/section-card";
import { PageHeader } from "@/components/layout/page-header";
import { getMarketOverview } from "@/features/markets/queries";
import { WatchlistManager } from "@/features/watchlist/components/watchlist";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Watchlist",
  description: "Track the assets you care about with live signals and risk.",
};

export const revalidate = 300;

export default async function WatchlistPage() {
  const overview = await getMarketOverview();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Esocity Markets"
        title="Watchlist"
        description="Your tracked assets with their current composite signal, conviction and regime."
      />
      <SectionCard title="Tracked assets" contentClassName="space-y-4">
        <WatchlistManager assets={overview.assets} />
      </SectionCard>
      <Disclaimer>{siteConfig.financialDisclaimer}</Disclaimer>
    </div>
  );
}
