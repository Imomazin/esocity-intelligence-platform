import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BarList } from "@/components/charts/bar-list";
import { ValueAreaChart } from "@/components/charts/time-series-chart";
import { Delta } from "@/components/data/delta";
import { DataSourceNote, Disclaimer } from "@/components/data/disclaimer";
import { KeyValueList } from "@/components/data/key-value-list";
import { SectionCard } from "@/components/data/section-card";
import { SignalBadge } from "@/components/indicators/badges";
import { ProbabilityMeter } from "@/components/indicators/meters";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ActivityFeed } from "@/features/dashboard/components/activity-feed";
import { PulseCards } from "@/features/dashboard/components/pulse-cards";
import { getDashboardView } from "@/features/dashboard/queries";
import { MatchRow } from "@/features/sports/components/match-row";
import { RiskPanel } from "@/features/trade/components/risk-panel";
import { WatchlistCompact } from "@/features/watchlist/components/watchlist";
import { formatDate, formatPercent, formatSignedNumber } from "@/lib/format";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Overview",
  description:
    "Esocity platform overview: market pulse, sports pulse, paper portfolio and model performance.",
};

export const dynamic = "force-dynamic";

function ViewAll({ href, label = "View all" }: { href: string; label?: string }) {
  return (
    <Button variant="link" size="sm" className="h-auto p-0" asChild>
      <Link href={href}>
        {label} <ArrowRight />
      </Link>
    </Button>
  );
}

export default async function DashboardPage() {
  const view = await getDashboardView();
  const { market, sports, paper } = view;
  const confidence = [...market.assets].sort((a, b) => b.confidence - a.confidence);
  const sportsAvgConfidence =
    sports.upcoming.length > 0
      ? sports.upcoming.reduce((total, match) => total + match.prediction.confidence, 0) /
        sports.upcoming.length
      : 0;
  const marketsAvgConfidence =
    market.assets.reduce((total, asset) => total + asset.confidence, 0) /
    Math.max(1, market.assets.length);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Esocity Core"
        title="Overview"
        description="Predictive intelligence across markets, sport and your paper portfolio — expressed as probabilities, not promises."
        meta={
          <DataSourceNote
            simulated={market.provider.isSimulated}
            source="Synthetic demo data"
            asOf={`Markets through ${formatDate(market.asOf)}`}
          />
        }
      />

      <PulseCards market={market} sports={sports} paper={paper} />

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard
          className="xl:col-span-2"
          title="Paper portfolio"
          description={`${paper.positions.length} open positions · ${paper.mode === "preview" ? "demo portfolio preview" : "your paper account"}`}
          action={<ViewAll href="/trade" label="Open trading" />}
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_14rem]">
            <ValueAreaChart
              data={paper.history.map((point) => ({ date: point.date, value: point.value }))}
              label="Portfolio value"
              height={208}
            />
            <KeyValueList
              items={[
                {
                  label: "Total P&L",
                  value: (
                    <Delta value={paper.summary.totalPnl} format="currency" showIcon={false} />
                  ),
                },
                {
                  label: "Unrealised",
                  value: (
                    <Delta value={paper.summary.unrealizedPnl} format="currency" showIcon={false} />
                  ),
                },
                {
                  label: "Realised",
                  value: (
                    <Delta value={paper.summary.realizedPnl} format="currency" showIcon={false} />
                  ),
                },
                { label: "Cash weight", value: formatPercent(paper.summary.cashWeight, 1) },
                {
                  label: "Largest position",
                  value: paper.summary.largestPosition
                    ? `${paper.summary.largestPosition.symbol} ${formatPercent(paper.summary.largestPosition.weight, 0)}`
                    : "—",
                },
              ]}
            />
          </div>
        </SectionCard>
        <SectionCard
          title="Risk status"
          description="Portfolio risk engine"
          action={<ViewAll href="/trade" label="Details" />}
        >
          <RiskPanel risk={paper.risk} compact />
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Watchlist" action={<ViewAll href="/watchlist" label="Manage" />}>
          <WatchlistCompact assets={market.assets} />
        </SectionCard>
        <SectionCard
          title="Recent signals"
          description="Latest composite signal changes"
          action={<ViewAll href="/markets" />}
          contentClassName="px-0"
        >
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Asset</TableHead>
                <TableHead>Signal</TableHead>
                <TableHead className="text-right">Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.recentSignals.map((signal) => (
                <TableRow key={`${signal.symbol}-${signal.date}`}>
                  <TableCell>
                    <Link
                      href={`/markets/${signal.symbol}`}
                      className="font-semibold hover:text-primary"
                    >
                      {signal.symbol}
                    </Link>
                    <span className="block text-[11px] text-muted-foreground">
                      {formatDate(signal.date)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <SignalBadge signal={signal.to} />
                    <span className="ml-1.5 text-[11px] text-muted-foreground">
                      {formatSignedNumber(signal.score, 2)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Delta value={signal.returnSince} fractionDigits={1} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
        <SectionCard
          title="Upcoming matches"
          description="Next seven days"
          action={<ViewAll href="/sports/football" />}
        >
          <div className="space-y-2">
            {view.upcomingMatches.slice(0, 4).map((match) => (
              <MatchRow key={match.id} match={match} compact />
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Model confidence" description="Current conviction by asset">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <ProbabilityMeter label="Markets avg" value={marketsAvgConfidence} />
              <ProbabilityMeter label="Sports avg" value={sportsAvgConfidence} />
            </div>
            <BarList
              ariaLabel="Signal confidence by asset"
              max={1}
              items={confidence.map((asset) => ({
                key: asset.symbol,
                label: asset.symbol,
                value: asset.confidence,
              }))}
            />
          </div>
        </SectionCard>
        <SectionCard
          title="Prediction performance"
          description="Out-of-sample, synthetic demo data"
          action={<ViewAll href="/model-lab" label="Model Lab" />}
        >
          <KeyValueList
            items={[
              {
                label: "Markets — directional hit rate",
                value:
                  market.evaluation.directionalHitRate === null
                    ? "—"
                    : formatPercent(market.evaluation.directionalHitRate, 1),
                hint: `${market.evaluation.directionalCalls.toLocaleString("en-US")} BUY/SELL calls`,
              },
              {
                label: "Markets — Brier skill",
                value:
                  market.evaluation.brierSkillScore === null
                    ? "—"
                    : `${formatSignedNumber(market.evaluation.brierSkillScore * 100, 2)}%`,
                hint: "vs historical base rate",
              },
              {
                label: "Football — 1X2 accuracy",
                value:
                  sports.evaluation.accuracy === null
                    ? "—"
                    : formatPercent(sports.evaluation.accuracy, 1),
                hint: `${sports.evaluation.matches} finished matches`,
              },
              {
                label: "Football — Brier skill",
                value:
                  sports.evaluation.brierSkillScore === null
                    ? "—"
                    : `${formatSignedNumber(sports.evaluation.brierSkillScore * 100, 1)}%`,
                hint: "vs typical base rates",
              },
              { label: "Football — log loss", value: sports.evaluation.logLoss?.toFixed(3) ?? "—" },
            ]}
          />
        </SectionCard>
        <SectionCard title="Recent activity">
          <ActivityFeed items={view.activity} />
        </SectionCard>
      </div>

      <Disclaimer>
        {siteConfig.disclaimer} {siteConfig.financialDisclaimer} {siteConfig.sportsDisclaimer}
      </Disclaimer>
    </div>
  );
}
