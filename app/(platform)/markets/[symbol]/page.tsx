import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MacdChart, RsiChart } from "@/components/charts/indicator-charts";
import { PriceChart } from "@/components/charts/price-chart";
import { Delta } from "@/components/data/delta";
import { DataSourceNote, Disclaimer } from "@/components/data/disclaimer";
import { KeyValueList } from "@/components/data/key-value-list";
import { SectionCard } from "@/components/data/section-card";
import { RiskBadge } from "@/components/indicators/badges";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { IndicatorsPanel } from "@/features/markets/components/indicators-panel";
import { SignalMethodology } from "@/features/markets/components/methodology";
import { MlSupplementPanel } from "@/features/markets/components/ml-supplement";
import { SignalHistoryTable } from "@/features/markets/components/signal-history";
import { SignalSummary } from "@/features/markets/components/signal-summary";
import { getAssetDetail } from "@/features/markets/queries";
import { formatCurrency, formatDateTimeUtc, formatSignedPercent } from "@/lib/format";
import { configuredMarketSymbols, getMarketDataProvider } from "@/lib/markets/providers";
import { siteConfig } from "@/lib/site";

export const revalidate = 300;
// The universe is fixed by configuration: unknown symbols are a real 404 rather than a streamed
// not-found page.
export const dynamicParams = false;

export function generateStaticParams() {
  return configuredMarketSymbols().map((symbol) => ({ symbol }));
}

type Params = { params: Promise<{ symbol: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { symbol } = await params;
  return {
    title: `${symbol.toUpperCase()} · Markets`,
    description: `Composite signal, indicators and risk for ${symbol.toUpperCase()} (${
      getMarketDataProvider().isSimulated ? "simulated demo data" : "end-of-day data"
    }).`,
  };
}

const SESSION_LABEL = {
  simulated: {
    open: "Live (simulated)",
    "pre-market": "Pre-market · last close",
    closed: "Market closed · last close",
  },
  // End-of-day providers: the quote is always the last completed session's close.
  delayed: {
    open: "Market open · last close (delayed)",
    "pre-market": "Pre-market · last close",
    closed: "Market closed · last close",
  },
} as const;

export default async function AssetPage({ params }: Params) {
  const { symbol } = await params;
  const detail = await getAssetDetail(symbol);
  if (!detail) notFound();
  const { profile, quote, signal, risk, performance } = detail;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
        <Link href="/markets">
          <ArrowLeft /> All markets
        </Link>
      </Button>

      <PageHeader
        eyebrow={`${profile.exchange} · ${profile.sector}`}
        title={
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>{profile.symbol}</span>
            <span className="text-base font-normal text-muted-foreground">{profile.name}</span>
          </span>
        }
        description={profile.description}
        meta={
          <DataSourceNote
            simulated={detail.provider.isSimulated}
            source={
              SESSION_LABEL[quote.source === "simulated" ? "simulated" : "delayed"][quote.session]
            }
            asOf={formatDateTimeUtc(quote.asOf)}
          />
        }
        actions={
          <div className="text-right">
            <p className="text-3xl font-semibold tracking-tight">{formatCurrency(quote.price)}</p>
            <p className="flex items-center justify-end gap-2 text-sm">
              <Delta value={quote.changePercent} />
              <span className="num text-muted-foreground">
                {quote.change >= 0 ? "+" : "−"}
                {formatCurrency(Math.abs(quote.change))}
              </span>
            </p>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <SectionCard
          title="Price history"
          description="Daily closes with 20- and 50-day moving averages; volume below"
        >
          <PriceChart data={detail.chart} symbol={profile.symbol} />
        </SectionCard>
        <SectionCard
          title="Signal"
          description={`Composite model · ${signal.horizonDays}-day horizon`}
        >
          <SignalSummary signal={signal} risk={risk} />
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <SectionCard
          title="Why this signal"
          description="Every component, its evidence, weight and contribution — the model is fully decomposable"
        >
          <SignalMethodology signal={signal} />
        </SectionCard>
        <div className="space-y-4">
          <SectionCard
            title="Risk score"
            description="Transparent 0–100 score"
            action={<RiskBadge level={risk.level} />}
          >
            <p className="mb-3 text-3xl font-semibold">
              {risk.score}
              <span className="text-sm font-normal text-muted-foreground"> / 100</span>
            </p>
            <KeyValueList
              items={risk.drivers.map((driver) => ({
                label: driver.label,
                value: driver.value,
                hint: `${driver.contribution} pts`,
              }))}
            />
          </SectionCard>
          <SectionCard title="Performance">
            <KeyValueList
              items={[
                {
                  label: "1 day",
                  value:
                    performance.change1d === null ? "—" : formatSignedPercent(performance.change1d),
                },
                {
                  label: "5 days",
                  value:
                    performance.change5d === null ? "—" : formatSignedPercent(performance.change5d),
                },
                {
                  label: "1 month",
                  value:
                    performance.change1m === null ? "—" : formatSignedPercent(performance.change1m),
                },
                {
                  label: "3 months",
                  value:
                    performance.change3m === null ? "—" : formatSignedPercent(performance.change3m),
                },
                {
                  label: "1 year",
                  value:
                    performance.change1y === null ? "—" : formatSignedPercent(performance.change1y),
                },
              ]}
            />
          </SectionCard>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="RSI (14)" description="Six months · Wilder smoothing">
          <RsiChart data={detail.chart} />
        </SectionCard>
        <SectionCard title="MACD (12, 26, 9)" description="Six months">
          <MacdChart data={detail.chart} />
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Technical indicators" className="xl:col-span-2">
          <IndicatorsPanel indicators={detail.indicators} />
        </SectionCard>
        <SectionCard title="ML service view" description="Optional Python model (experimental)">
          <MlSupplementPanel supplement={detail.mlSupplement} engine={detail.engine} />
        </SectionCard>
      </div>

      <SectionCard
        title="Recent signal history"
        description="Signal changes over the past year with the return since each change"
        contentClassName="px-0"
      >
        <SignalHistoryTable history={detail.signalHistory} />
      </SectionCard>

      <Disclaimer>
        {siteConfig.financialDisclaimer} Calibration: P(up) = σ(
        {detail.calibration.intercept.toFixed(3)} + {detail.calibration.slope.toFixed(3)} × score),
        fitted on {detail.calibration.samples.toLocaleString("en-US")} walk-forward samples (base
        rate {(detail.calibration.baseRate * 100).toFixed(1)}%).
      </Disclaimer>
    </div>
  );
}
