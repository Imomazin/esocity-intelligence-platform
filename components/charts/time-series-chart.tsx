"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ACTIVE_DOT,
  AXIS_LINE,
  AXIS_TICK,
  ChartFrame,
  ChartLegend,
  CURSOR,
  GRID_STROKE,
  makeTooltip,
  SERIES,
} from "@/components/charts/chart-kit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatPercent,
  formatShortDate,
} from "@/lib/format";

export interface ValuePoint {
  date: string;
  value: number;
}

/** Single-series value history (portfolio value). Area wash at ~10%; no legend (title names it). */
export function ValueAreaChart({
  data,
  label,
  height = 224,
}: {
  data: ValuePoint[];
  label: string;
  height?: number;
}) {
  const tooltip = useMemo(
    () =>
      makeTooltip(
        [{ key: "value", label, color: SERIES.s1, format: (v) => formatCurrency(v) }],
        formatDate,
      ),
    [label],
  );
  const first = data[0];
  const last = data[data.length - 1];
  const summary =
    first && last
      ? `${label}: ${formatCurrency(first.value)} on ${formatDate(first.date)} to ${formatCurrency(last.value)} on ${formatDate(last.date)}.`
      : label;
  return (
    <ChartFrame
      chart={
        <figure aria-label={summary} style={{ height }} className="w-full">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height }}>
            <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis
                dataKey="date"
                tickFormatter={formatShortDate}
                minTickGap={48}
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
              />
              <YAxis
                orientation="right"
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => formatCompactCurrency(v)}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <Tooltip content={tooltip} cursor={CURSOR} />
              <Area
                type="monotone"
                dataKey="value"
                stroke={SERIES.s1}
                strokeWidth={2}
                fill={SERIES.s1}
                fillOpacity={0.1}
                dot={false}
                activeDot={ACTIVE_DOT}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </figure>
      }
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">{label}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="num">
            {[...data].reverse().map((point) => (
              <TableRow key={point.date}>
                <TableCell>{formatDate(point.date)}</TableCell>
                <TableCell className="text-right">{formatCurrency(point.value)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    />
  );
}

export interface EquityPointView {
  date: string;
  equity: number;
  benchmark: number;
  drawdown: number;
}

const equityTooltip = makeTooltip(
  [
    {
      key: "equity",
      label: "Strategy",
      color: SERIES.s1,
      format: (v) => formatCurrency(v, { maximumFractionDigits: 0 }),
    },
    {
      key: "benchmark",
      label: "Buy & hold",
      color: SERIES.s2,
      format: (v) => formatCurrency(v, { maximumFractionDigits: 0 }),
    },
  ],
  formatDate,
);

const drawdownTooltip = makeTooltip(
  [
    {
      key: "drawdown",
      label: "Drawdown",
      color: SERIES.critical,
      format: (v) => formatPercent(v, 1),
    },
  ],
  formatDate,
);

/** Strategy vs benchmark equity (two series → legend) plus a separate drawdown panel. */
export function EquityCurveChart({ data, symbol }: { data: EquityPointView[]; symbol: string }) {
  return (
    <ChartFrame
      legend={
        <ChartLegend
          entries={[
            { label: "Strategy", color: SERIES.s1 },
            { label: `Buy & hold ${symbol}`, color: SERIES.s2 },
          ]}
        />
      }
      chart={
        <figure
          aria-label={`Equity curve for the strategy versus buy and hold ${symbol}`}
          className="space-y-2"
        >
          <div className="h-64 w-full">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 720, height: 256 }}
            >
              <LineChart
                data={data}
                margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
                syncId="equity"
              >
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  minTickGap={48}
                  tick={AXIS_TICK}
                  axisLine={AXIS_LINE}
                  tickLine={false}
                />
                <YAxis
                  orientation="right"
                  domain={["auto", "auto"]}
                  tickFormatter={(v: number) => formatCompactCurrency(v)}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                />
                <Tooltip content={equityTooltip} cursor={CURSOR} />
                <Line
                  type="monotone"
                  dataKey="benchmark"
                  stroke={SERIES.s2}
                  strokeWidth={2}
                  dot={false}
                  activeDot={ACTIVE_DOT}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="equity"
                  stroke={SERIES.s1}
                  strokeWidth={2}
                  dot={false}
                  activeDot={ACTIVE_DOT}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="h-24 w-full">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 720, height: 96 }}
            >
              <AreaChart
                data={data}
                margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
                syncId="equity"
              >
                <XAxis dataKey="date" hide />
                <YAxis
                  orientation="right"
                  tickFormatter={(v: number) => formatPercent(v, 0)}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                  tickCount={3}
                />
                <Tooltip content={drawdownTooltip} cursor={CURSOR} />
                <Area
                  type="monotone"
                  dataKey="drawdown"
                  stroke={SERIES.critical}
                  strokeWidth={1.5}
                  fill={SERIES.critical}
                  fillOpacity={0.12}
                  dot={false}
                  activeDot={ACTIVE_DOT}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <figcaption className="text-[11px] text-muted-foreground">
            Lower panel: strategy drawdown from its running peak.
          </figcaption>
        </figure>
      }
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Strategy</TableHead>
              <TableHead className="text-right">Buy &amp; hold</TableHead>
              <TableHead className="text-right">Drawdown</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="num">
            {[...data].reverse().map((point) => (
              <TableRow key={point.date}>
                <TableCell>{formatDate(point.date)}</TableCell>
                <TableCell className="text-right">
                  {formatCurrency(point.equity, { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(point.benchmark, { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell className="text-right">{formatPercent(point.drawdown, 1)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    />
  );
}
