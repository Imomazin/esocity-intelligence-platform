import type { Metadata } from "next";
import Link from "next/link";

import { Disclaimer } from "@/components/data/disclaimer";
import { KeyValueList } from "@/components/data/key-value-list";
import { SectionCard } from "@/components/data/section-card";
import { RegimeBadge, RiskBadge, SignalBadge } from "@/components/indicators/badges";
import { PageHeader } from "@/components/layout/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDashboardView } from "@/features/dashboard/queries";
import { PrintButton } from "@/features/reports/components/print-button";
import { RiskPanel } from "@/features/trade/components/risk-panel";
import {
  formatCurrency,
  formatDate,
  formatPercent,
  formatProbability,
  formatSignedNumber,
  formatSignedPercent,
} from "@/lib/format";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Reports",
  description:
    "Auto-generated intelligence briefs for markets, sports models and the paper portfolio.",
};

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const { market, sports, paper, recentSignals } = await getDashboardView();
  const byConviction = [...market.assets].sort((a, b) => b.confidence - a.confidence);
  const elevatedRisk = market.assets.filter(
    (asset) => asset.riskLevel === "HIGH" || asset.riskLevel === "VERY_HIGH",
  );
  const tone =
    market.breadth.averageScore > 0.15
      ? "risk-on"
      : market.breadth.averageScore < -0.15
        ? "risk-off"
        : "mixed";
  const uncertain = sports.upcoming.filter(
    (match) =>
      match.prediction.uncertainty === "VERY_HIGH" || match.prediction.uncertainty === "HIGH",
  );
  const favourites = [...sports.upcoming]
    .sort(
      (a, b) =>
        Math.max(b.prediction.home, b.prediction.away) -
        Math.max(a.prediction.home, a.prediction.away),
    )
    .slice(0, 3);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Esocity Core"
        title="Reports"
        description="Briefs generated on demand from the same engines that power the platform. Every figure is reproducible."
        actions={<PrintButton />}
      />

      <Tabs defaultValue="markets" className="gap-4">
        <TabsList className="no-print">
          <TabsTrigger value="markets">Market intelligence brief</TabsTrigger>
          <TabsTrigger value="sports">Sports model review</TabsTrigger>
          <TabsTrigger value="portfolio">Portfolio risk report</TabsTrigger>
        </TabsList>

        <TabsContent value="markets" className="space-y-4">
          <SectionCard
            title={`Market intelligence brief — ${formatDate(market.asOf)}`}
            description="Composite signal model · 20-day horizon · synthetic demo universe"
          >
            <div className="space-y-5 text-sm leading-relaxed">
              <p>
                The demo universe screens <strong>{tone}</strong> with an average composite score of{" "}
                {formatSignedNumber(market.breadth.averageScore, 2)}:{" "}
                {market.breadth.signalCounts.BUY} BUY, {market.breadth.signalCounts.HOLD} HOLD and{" "}
                {market.breadth.signalCounts.SELL} SELL signals. {market.breadth.aboveSma50} of{" "}
                {market.breadth.assets} assets trade above their 50-day average.
                {market.benchmark && (
                  <>
                    {" "}
                    The benchmark (SPY) is in a{" "}
                    <strong>{market.benchmark.regime.replace("_", " ").toLowerCase()}</strong>{" "}
                    regime with a {market.benchmark.signal} signal.
                  </>
                )}
              </p>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Asset</TableHead>
                    <TableHead>Signal</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="text-right">Confidence</TableHead>
                    <TableHead className="text-right">P(up)</TableHead>
                    <TableHead>Regime</TableHead>
                    <TableHead className="text-right">3M</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="num">
                  {byConviction.map((asset) => (
                    <TableRow key={asset.symbol}>
                      <TableCell className="font-semibold">
                        <Link href={`/markets/${asset.symbol}`} className="hover:text-primary">
                          {asset.symbol}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <SignalBadge signal={asset.signal} />
                      </TableCell>
                      <TableCell className="text-right">
                        {formatSignedNumber(asset.score, 2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatProbability(asset.confidence)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatProbability(asset.probabilityUp)}
                      </TableCell>
                      <TableCell>
                        <RegimeBadge regime={asset.regime} />
                      </TableCell>
                      <TableCell className="text-right">
                        {asset.performance.change3m === null
                          ? "—"
                          : formatSignedPercent(asset.performance.change3m, 1)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-1 font-semibold">Recent signal changes</p>
                  <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                    {recentSignals.slice(0, 5).map((signal) => (
                      <li key={`${signal.symbol}-${signal.date}`}>
                        {formatDate(signal.date)}:{" "}
                        <span className="text-foreground">{signal.symbol}</span>{" "}
                        {signal.from ?? "—"} → {signal.to} (
                        {formatSignedPercent(signal.returnSince, 1)} since)
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 font-semibold">Risk flags</p>
                  {elevatedRisk.length === 0 ? (
                    <p className="text-muted-foreground">
                      No assets currently carry a high or very high risk score.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {elevatedRisk.map((asset) => (
                        <li key={asset.symbol} className="flex items-center gap-2">
                          <span className="font-semibold">{asset.symbol}</span>
                          <RiskBadge level={asset.riskLevel} />
                          <span className="text-muted-foreground">score {asset.riskScore}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Model quality: walk-forward directional hit rate{" "}
                {market.evaluation.directionalHitRate === null
                  ? "—"
                  : formatPercent(market.evaluation.directionalHitRate, 1)}{" "}
                and Brier skill{" "}
                {market.evaluation.brierSkillScore === null
                  ? "—"
                  : `${formatSignedNumber(market.evaluation.brierSkillScore * 100, 2)}%`}{" "}
                vs the base rate. {siteConfig.financialDisclaimer}
              </p>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="sports" className="space-y-4">
          <SectionCard
            title="Sports model review"
            description="Football · Poisson / Dixon–Coles · fictional demo competitions"
          >
            <div className="space-y-5 text-sm leading-relaxed">
              <KeyValueList
                columns={3}
                items={[
                  { label: "Finished matches evaluated", value: sports.evaluation.matches },
                  {
                    label: "1X2 accuracy",
                    value:
                      sports.evaluation.accuracy === null
                        ? "—"
                        : formatPercent(sports.evaluation.accuracy, 1),
                  },
                  {
                    label: "Brier score",
                    value: sports.evaluation.brierScore?.toFixed(4) ?? "—",
                    hint: `base rates ${sports.evaluation.baselineBrierScore?.toFixed(4) ?? "—"}`,
                  },
                  {
                    label: "Brier skill",
                    value:
                      sports.evaluation.brierSkillScore === null
                        ? "—"
                        : `${formatSignedNumber(sports.evaluation.brierSkillScore * 100, 1)}%`,
                  },
                  { label: "Log loss", value: sports.evaluation.logLoss?.toFixed(4) ?? "—" },
                  {
                    label: "Over 2.5 Brier",
                    value: sports.evaluation.over25Brier?.toFixed(4) ?? "—",
                    hint: `base rate ${sports.evaluation.over25BaselineBrier?.toFixed(4) ?? "—"}`,
                  },
                ]}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-1 font-semibold">Strongest favourites (next 10 days)</p>
                  <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                    {favourites.map((match) => (
                      <li key={match.id}>
                        <Link
                          href={`/sports/match/${match.id}`}
                          className="text-foreground hover:text-primary"
                        >
                          {match.home.name} v {match.away.name}
                        </Link>{" "}
                        — H {formatProbability(match.prediction.home)} · D{" "}
                        {formatProbability(match.prediction.draw)} · A{" "}
                        {formatProbability(match.prediction.away)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 font-semibold">High-uncertainty fixtures</p>
                  <p className="text-muted-foreground">
                    {uncertain.length} of {sports.upcoming.length} upcoming fixtures carry high or
                    very high uncertainty — outcome probabilities close to even. Treat any single
                    view on these with particular caution.
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{siteConfig.sportsDisclaimer}</p>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="portfolio" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
            <SectionCard
              title="Portfolio risk report"
              description={
                paper.mode === "preview" ? "Demo portfolio preview" : "Your paper account"
              }
            >
              <div className="space-y-4 text-sm">
                <KeyValueList
                  columns={2}
                  items={[
                    { label: "Total value", value: formatCurrency(paper.summary.totalValue) },
                    {
                      label: "Total return",
                      value: formatSignedPercent(paper.summary.totalReturn, 2),
                    },
                    { label: "Cash", value: formatCurrency(paper.summary.cash) },
                    {
                      label: "Gross exposure",
                      value: formatPercent(paper.summary.grossExposure, 1),
                    },
                    { label: "Unrealised P&L", value: formatCurrency(paper.summary.unrealizedPnl) },
                    { label: "Realised P&L", value: formatCurrency(paper.summary.realizedPnl) },
                    {
                      label: "Largest position",
                      value: paper.summary.largestPosition
                        ? `${paper.summary.largestPosition.symbol} ${formatPercent(paper.summary.largestPosition.weight, 1)}`
                        : "—",
                    },
                    {
                      label: "Concentration (HHI)",
                      value: paper.summary.herfindahlIndex.toFixed(3),
                    },
                  ]}
                />
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Position</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Weight</TableHead>
                      <TableHead className="text-right">Unrealised</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="num">
                    {paper.positions.map((position) => (
                      <TableRow key={position.symbol}>
                        <TableCell className="font-semibold">{position.symbol}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(position.marketValue)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatPercent(position.weight, 1)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatSignedPercent(position.unrealizedPnlPercent, 1)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>
            <SectionCard title="Risk assessment">
              <RiskPanel risk={paper.risk} />
            </SectionCard>
          </div>
        </TabsContent>
      </Tabs>

      <Disclaimer>
        {siteConfig.disclaimer} Reports summarise model outputs on synthetic demo data and are not
        advice.
      </Disclaimer>
    </div>
  );
}
