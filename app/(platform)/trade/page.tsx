import {
  Banknote,
  BriefcaseBusiness,
  Landmark,
  ShieldAlert,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { Metadata } from "next";

import { BarList } from "@/components/charts/bar-list";
import { ValueAreaChart } from "@/components/charts/time-series-chart";
import { Delta } from "@/components/data/delta";
import { Disclaimer } from "@/components/data/disclaimer";
import { SectionCard } from "@/components/data/section-card";
import { StatCard } from "@/components/data/stat-card";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrderTicket } from "@/features/trade/components/order-ticket";
import { ResetAccountButton } from "@/features/trade/components/reset-account";
import { RiskPanel } from "@/features/trade/components/risk-panel";
import {
  ClosedPositionsTable,
  OrdersTable,
  PositionsTable,
} from "@/features/trade/components/trade-tables";
import { getPaperTradingView } from "@/features/trade/queries";
import { formatCurrency, formatPercent } from "@/lib/format";

export const metadata: Metadata = {
  title: "Trade (paper)",
  description: "Paper trading with simulated fills, portfolio analytics and transparent risk.",
};

export const dynamic = "force-dynamic";

const STORAGE_LABEL = {
  postgres: "PostgreSQL (durable)",
  upstash: "Upstash Redis (durable)",
  memory: "Server memory (demo, non-durable)",
  preview: "Not yet saved — preview",
} as const;

export default async function TradePage() {
  const view = await getPaperTradingView();
  const { summary, risk } = view;
  const holdings = Object.fromEntries(
    view.positions.map((position) => [position.symbol, position.quantity]),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Esocity Trade"
        title="Paper trading"
        description="Simulated execution against demo quotes — practise, measure and stress-test ideas with zero financial risk."
        meta={
          <>
            <span className="inline-flex items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5 font-semibold text-foreground">
              PAPER ONLY
            </span>
            <span>{view.broker.displayName}</span>
            <span aria-hidden>·</span>
            <span>Storage: {STORAGE_LABEL[view.storage.kind]}</span>
          </>
        }
        actions={<ResetAccountButton />}
      />

      {view.mode === "preview" && (
        <Alert variant="info">
          <BriefcaseBusiness />
          <AlertTitle>You are viewing the demo portfolio</AlertTitle>
          <AlertDescription>
            It becomes your own paper account the moment you place your first order (an anonymous
            session cookie keeps it separate from other visitors).
          </AlertDescription>
        </Alert>
      )}
      {view.storage.warning && (
        <Alert variant="warning">
          <ShieldAlert />
          <AlertTitle>Storage notice</AlertTitle>
          <AlertDescription>{view.storage.warning}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard
          className="xl:col-span-2"
          label="Portfolio value"
          icon={<Wallet />}
          value={formatCurrency(summary.totalValue)}
          delta={<Delta value={summary.dayChangePercent} />}
          footnote="today"
        />
        <StatCard
          label="Cash"
          icon={<Banknote />}
          value={formatCurrency(summary.cash, { maximumFractionDigits: 0 })}
          footnote={`${formatPercent(summary.cashWeight, 0)} of portfolio`}
        />
        <StatCard
          label="Invested capital"
          icon={<Landmark />}
          value={formatCurrency(summary.investedCapital, { maximumFractionDigits: 0 })}
          footnote="cost basis"
        />
        <StatCard
          label="Unrealised P&L"
          icon={<TrendingUp />}
          value={
            <Delta
              value={summary.unrealizedPnl}
              format="currency"
              showIcon={false}
              className="text-2xl font-semibold"
            />
          }
          footnote={<Delta value={summary.unrealizedReturn} className="text-xs" />}
        />
        <StatCard
          label="Realised P&L"
          icon={<TrendingUp />}
          value={
            <Delta
              value={summary.realizedPnl}
              format="currency"
              showIcon={false}
              className="text-2xl font-semibold"
            />
          }
          footnote={`Fees ${formatCurrency(summary.feesPaid)}`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-4">
          <SectionCard
            title="Portfolio value"
            description={`Total return ${summary.totalReturn >= 0 ? "+" : "−"}${formatPercent(Math.abs(summary.totalReturn), 2)} on ${formatCurrency(summary.startingCash, { maximumFractionDigits: 0 })} starting cash`}
          >
            <ValueAreaChart
              data={view.history.map((point) => ({ date: point.date, value: point.value }))}
              label="Portfolio value"
            />
          </SectionCard>

          <SectionCard title="Account activity" contentClassName="px-0">
            <Tabs defaultValue="positions" className="gap-4">
              <TabsList className="mx-5">
                <TabsTrigger value="positions">
                  Open positions ({view.positions.length})
                </TabsTrigger>
                <TabsTrigger value="orders">Orders ({view.orders.length})</TabsTrigger>
                <TabsTrigger value="closed">Closed ({view.closedPositions.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="positions">
                <PositionsTable positions={view.positions} />
              </TabsContent>
              <TabsContent value="orders">
                <OrdersTable orders={view.orders} />
              </TabsContent>
              <TabsContent value="closed">
                <ClosedPositionsTable closed={view.closedPositions} />
              </TabsContent>
            </Tabs>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Order ticket" description="Market orders · simulated fills">
            <OrderTicket
              quotes={view.quotes}
              cash={summary.cash}
              holdings={holdings}
              holdingsValue={summary.marketValue}
              execution={view.execution}
              limits={view.limits}
            />
          </SectionCard>
          <SectionCard title="Risk" description="Portfolio risk engine">
            <RiskPanel risk={risk} />
          </SectionCard>
          <SectionCard title="Exposure" description="Share of total portfolio value">
            <BarList
              ariaLabel="Exposure by asset"
              items={view.exposure.map((slice) => ({
                key: slice.symbol,
                label: slice.label,
                value: slice.weight,
                muted: slice.symbol === "CASH",
              }))}
              max={1}
            />
            <p className="mt-3 text-[11px] text-muted-foreground">
              Largest position:{" "}
              {summary.largestPosition
                ? `${summary.largestPosition.symbol} ${formatPercent(summary.largestPosition.weight, 1)}`
                : "—"}{" "}
              · HHI {summary.herfindahlIndex.toFixed(3)}
            </p>
          </SectionCard>
        </div>
      </div>

      <Disclaimer>
        Paper trading only. No orders are routed to any broker or exchange and no real money is
        involved. Live execution is disabled by design and requires the controls described in the
        platform documentation.
      </Disclaimer>
    </div>
  );
}
