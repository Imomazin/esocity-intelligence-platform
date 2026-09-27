"use client";

import { useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ChartPoint } from "@/features/markets/types";
import { formatCompact, formatDate, formatNumber, formatShortDate } from "@/lib/format";
import { usePreferences, type ChartRange } from "@/lib/hooks/use-preferences";

const RANGES: { key: ChartRange; bars: number }[] = [
  { key: "1M", bars: 21 },
  { key: "3M", bars: 63 },
  { key: "6M", bars: 126 },
  { key: "1Y", bars: 252 },
  { key: "2Y", bars: 504 },
];

const priceTooltip = makeTooltip(
  [
    { key: "close", label: "Close", color: SERIES.s1, format: (v) => `$${formatNumber(v)}` },
    { key: "sma20", label: "SMA 20", color: SERIES.s2, format: (v) => `$${formatNumber(v)}` },
    { key: "sma50", label: "SMA 50", color: SERIES.s3, format: (v) => `$${formatNumber(v)}` },
  ],
  formatDate,
);

const volumeTooltip = makeTooltip(
  [{ key: "volume", label: "Volume", color: SERIES.s1, format: (v) => formatCompact(v) }],
  formatDate,
);

export function PriceChart({ data, symbol }: { data: ChartPoint[]; symbol: string }) {
  const [preferences] = usePreferences();
  // null = follow the saved default range (Settings) until the user picks one here.
  const [selected, setRange] = useState<ChartRange | null>(null);
  const range = selected ?? preferences.defaultChartRange;
  const visible = useMemo(() => {
    const bars = RANGES.find((entry) => entry.key === range)?.bars ?? 126;
    return data.slice(-bars);
  }, [data, range]);

  const first = visible[0];
  const last = visible[visible.length - 1];
  const summary =
    first && last
      ? `${symbol} closed at $${formatNumber(last.close)} on ${formatDate(last.date)}, ${last.close >= first.close ? "up" : "down"} ${Math.abs((last.close / first.close - 1) * 100).toFixed(1)}% over the selected range.`
      : `${symbol} price history`;

  return (
    <ChartFrame
      toolbar={
        <ToggleGroup
          type="single"
          value={range}
          onValueChange={(value) => value && setRange(value as ChartRange)}
          aria-label="Chart range"
        >
          {RANGES.map((entry) => (
            <ToggleGroupItem key={entry.key} value={entry.key}>
              {entry.key}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
      legend={
        <ChartLegend
          entries={[
            { label: "Close", color: SERIES.s1 },
            { label: "SMA 20", color: SERIES.s2 },
            { label: "SMA 50", color: SERIES.s3 },
          ]}
        />
      }
      chart={
        <figure aria-label={summary} className="space-y-1">
          <div className="h-72 w-full">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 720, height: 288 }}
            >
              <ComposedChart
                data={visible}
                margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
                syncId={`price-${symbol}`}
              >
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  minTickGap={40}
                  tick={AXIS_TICK}
                  axisLine={AXIS_LINE}
                  tickLine={false}
                />
                <YAxis
                  orientation="right"
                  domain={["auto", "auto"]}
                  tickFormatter={(value: number) => formatNumber(value, value < 100 ? 2 : 0)}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip content={priceTooltip} cursor={CURSOR} />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke={SERIES.s1}
                  strokeWidth={2}
                  fill={SERIES.s1}
                  fillOpacity={0.1}
                  dot={false}
                  activeDot={ACTIVE_DOT}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="sma20"
                  stroke={SERIES.s2}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="sma50"
                  stroke={SERIES.s3}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="h-20 w-full">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 720, height: 80 }}
            >
              <BarChart
                data={visible}
                margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
                syncId={`price-${symbol}`}
              >
                <XAxis dataKey="date" hide />
                <YAxis
                  orientation="right"
                  tickFormatter={(value: number) => formatCompact(value)}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                  tickCount={3}
                />
                <Tooltip content={volumeTooltip} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
                <Bar
                  dataKey="volume"
                  fill={SERIES.s1}
                  fillOpacity={0.45}
                  radius={[1, 1, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <figcaption className="text-[11px] text-muted-foreground">
            Daily volume (separate axis panel)
          </figcaption>
        </figure>
      }
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="text-right">High</TableHead>
              <TableHead className="text-right">Low</TableHead>
              <TableHead className="text-right">Close</TableHead>
              <TableHead className="text-right">SMA 20</TableHead>
              <TableHead className="text-right">SMA 50</TableHead>
              <TableHead className="text-right">Volume</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="num">
            {[...visible].reverse().map((point) => (
              <TableRow key={point.date}>
                <TableCell>{formatDate(point.date)}</TableCell>
                <TableCell className="text-right">{formatNumber(point.open)}</TableCell>
                <TableCell className="text-right">{formatNumber(point.high)}</TableCell>
                <TableCell className="text-right">{formatNumber(point.low)}</TableCell>
                <TableCell className="text-right font-medium">
                  {formatNumber(point.close)}
                </TableCell>
                <TableCell className="text-right">
                  {point.sma20 === null ? "—" : formatNumber(point.sma20)}
                </TableCell>
                <TableCell className="text-right">
                  {point.sma50 === null ? "—" : formatNumber(point.sma50)}
                </TableCell>
                <TableCell className="text-right">{formatCompact(point.volume)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    />
  );
}
