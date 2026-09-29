import { CircleAlert, Cpu } from "lucide-react";
import type { Metadata } from "next";

import { EquityCurveChart } from "@/components/charts/time-series-chart";
import { Delta } from "@/components/data/delta";
import { Disclaimer } from "@/components/data/disclaimer";
import { EmptyState } from "@/components/data/empty-state";
import { SectionCard } from "@/components/data/section-card";
import { StatCard } from "@/components/data/stat-card";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BacktestForm } from "@/features/backtesting/components/backtest-form";
import { backtestParamsSchema, runBacktestForParams } from "@/features/backtesting/queries";
import { getDataSources } from "@/features/platform/data-sources";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/format";

export const metadata: Metadata = {
  title: "Backtesting",
  description:
    "Leak-free daily backtests of SMA crossover, momentum and the composite Esocity signal.",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BacktestingPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const parsed = backtestParamsSchema.safeParse({
    symbol: first(raw.symbol),
    strategy: first(raw.strategy),
    startDate: first(raw.startDate) || undefined,
    endDate: first(raw.endDate) || undefined,
    initialCapital: first(raw.initialCapital),
    feeBps: first(raw.feeBps),
    slippageBps: first(raw.slippageBps),
  });
  const data = await runBacktestForParams(
    parsed.success ? parsed.data : backtestParamsSchema.parse({}),
  );
  const inputError = parsed.success
    ? null
    : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  const result = data.result;
  const strategy = data.strategies.find((entry) => entry.id === data.params.strategy);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Esocity Trade · Research"
        title="Backtesting"
        description="Test rules against history with realistic frictions. Signals are computed at the close and executed at the next open — never on information the strategy could not have had."
      />

      <SectionCard title="Configuration">
        <BacktestForm
          symbols={data.symbols}
          strategies={data.strategies}
          values={data.params}
          range={data.range}
        />
      </SectionCard>

      {(inputError || data.error) && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Backtest could not run with these inputs</AlertTitle>
          <AlertDescription>{inputError ?? data.error}</AlertDescription>
        </Alert>
      )}

      {result ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Ending capital"
              value={formatCurrency(result.metrics.endingCapital, { maximumFractionDigits: 0 })}
              delta={<Delta value={result.metrics.totalReturn} />}
              footnote={`from ${formatCurrency(result.metrics.startingCapital, { maximumFractionDigits: 0 })}`}
            />
            <StatCard
              label="Buy & hold benchmark"
              value={
                <Delta
                  value={result.metrics.benchmarkReturn}
                  showIcon={false}
                  className="text-2xl font-semibold"
                />
              }
              footnote={
                <>
                  Excess <Delta value={result.metrics.excessReturn} className="text-xs" />
                </>
              }
            />
            <StatCard
              label="Max drawdown"
              value={formatPercent(result.metrics.maxDrawdown, 1)}
              footnote={`Benchmark ${formatPercent(result.metrics.benchmarkMaxDrawdown, 1)}`}
            />
            <StatCard
              label="Sharpe-like ratio"
              value={formatNumber(result.metrics.sharpe, 2)}
              footnote={`Benchmark ${formatNumber(result.metrics.benchmarkSharpe, 2)} · rf = 0`}
            />
            <StatCard
              label="Trades"
              value={result.metrics.trades}
              footnote={`Win rate ${result.metrics.winRate === null ? "—" : formatPercent(result.metrics.winRate, 0)}`}
            />
            <StatCard
              label="Volatility (ann.)"
              value={formatPercent(result.metrics.volatility, 1)}
              footnote={`CAGR ${formatPercent(result.metrics.cagr, 1)}`}
            />
            <StatCard
              label="Time in market"
              value={formatPercent(result.metrics.exposure, 0)}
              footnote={`${result.metrics.tradingDays} trading days`}
            />
            <StatCard
              label="Costs paid"
              value={formatCurrency(result.metrics.feesPaid, { maximumFractionDigits: 0 })}
              footnote={`${result.config.feeBps} bps fee · ${result.config.slippageBps} bps slippage`}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
            <SectionCard
              title={`${result.strategyName} · ${result.config.symbol}`}
              description={`${formatDate(result.config.startDate)} → ${formatDate(result.config.endDate)}`}
            >
              <EquityCurveChart data={result.equityCurve} symbol={result.config.symbol} />
            </SectionCard>
            <div className="space-y-4">
              <SectionCard title="Strategy rules">
                <p className="mb-3 text-sm text-muted-foreground">{strategy?.description}</p>
                <ul className="list-disc space-y-1 pl-4 text-sm">
                  {strategy?.rules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </SectionCard>
              <SectionCard
                title="Assumptions"
                description={data.engine ? `Engine: ${data.engine.name}` : undefined}
              >
                <ul className="space-y-2 text-xs text-muted-foreground">
                  {result.assumptions.map((assumption) => (
                    <li key={assumption} className="flex gap-2">
                      <Cpu className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {assumption}
                    </li>
                  ))}
                </ul>
                {result.warnings.map((warning) => (
                  <p key={warning} className="mt-3 rounded-md bg-status-warning/10 p-2 text-xs">
                    {warning}
                  </p>
                ))}
              </SectionCard>
            </div>
          </div>

          <SectionCard
            title="Trades"
            description="Round trips; an open position is marked to the final close"
            contentClassName="px-0"
          >
            {result.trades.length === 0 ? (
              <EmptyState
                title="No trades"
                description="The strategy never entered a position in this window."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Signal</TableHead>
                    <TableHead>Entry (next open)</TableHead>
                    <TableHead className="text-right">Entry price</TableHead>
                    <TableHead>Exit</TableHead>
                    <TableHead className="text-right">Exit price</TableHead>
                    <TableHead className="text-right">Shares</TableHead>
                    <TableHead className="text-right">P&amp;L</TableHead>
                    <TableHead className="text-right">Return</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="num">
                  {result.trades.map((trade) => (
                    <TableRow key={`${trade.entryDate}-${trade.signalDate}`}>
                      <TableCell className="text-muted-foreground">
                        {formatDate(trade.signalDate)}
                      </TableCell>
                      <TableCell>{formatDate(trade.entryDate)}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(trade.entryPrice)}
                      </TableCell>
                      <TableCell>
                        {trade.open ? (
                          <span className="text-xs font-medium">Open</span>
                        ) : trade.exitDate ? (
                          formatDate(trade.exitDate)
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {trade.exitPrice === null ? "—" : formatCurrency(trade.exitPrice)}
                      </TableCell>
                      <TableCell className="text-right">{trade.shares}</TableCell>
                      <TableCell className="text-right">
                        <Delta value={trade.pnl} format="currency" showIcon={false} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Delta value={trade.returnPct} fractionDigits={1} />
                      </TableCell>
                      <TableCell className="text-right">{trade.holdingDays}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </>
      ) : (
        !data.error && <EmptyState title="Configure a backtest above" />
      )}

      <Disclaimer>
        {getDataSources().markets.simulated
          ? "Simulated results on synthetic demo prices."
          : "Simulated trades on historical end-of-day prices."}{" "}
        Backtests are hypothetical, benefit from hindsight in strategy design, and do not predict
        future results.
      </Disclaimer>
    </div>
  );
}
