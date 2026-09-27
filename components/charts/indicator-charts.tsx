"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ACTIVE_DOT,
  AXIS_LINE,
  AXIS_TICK,
  ChartLegend,
  CURSOR,
  GRID_STROKE,
  makeTooltip,
  SERIES,
} from "@/components/charts/chart-kit";
import type { ChartPoint } from "@/features/markets/types";
import { formatDate, formatShortDate } from "@/lib/format";

const rsiTooltip = makeTooltip(
  [{ key: "rsi14", label: "RSI (14)", color: SERIES.s1, format: (v) => v.toFixed(1) }],
  formatDate,
);

const macdTooltip = makeTooltip(
  [
    { key: "macd", label: "MACD", color: SERIES.s1, format: (v) => v.toFixed(3) },
    { key: "macdSignal", label: "Signal", color: SERIES.s2, format: (v) => v.toFixed(3) },
    { key: "macdHistogram", label: "Histogram", color: SERIES.mid, format: (v) => v.toFixed(3) },
  ],
  formatDate,
);

/** RSI(14) with the 30/70 thresholds as dashed reference lines (dashes mean "threshold"). */
export function RsiChart({ data }: { data: ChartPoint[] }) {
  const visible = data.slice(-126);
  const latest = visible[visible.length - 1]?.rsi14;
  return (
    <figure
      aria-label={`RSI(14) over six months${latest !== null && latest !== undefined ? `, latest ${latest.toFixed(1)}` : ""}`}
    >
      <div className="h-36 w-full">
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 480, height: 144 }}
        >
          <LineChart data={visible} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
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
              domain={[0, 100]}
              ticks={[30, 50, 70]}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <ReferenceLine
              y={70}
              stroke="var(--negative)"
              strokeDasharray="4 4"
              strokeOpacity={0.7}
            />
            <ReferenceLine
              y={30}
              stroke="var(--positive)"
              strokeDasharray="4 4"
              strokeOpacity={0.7}
            />
            <Tooltip content={rsiTooltip} cursor={CURSOR} />
            <Line
              type="monotone"
              dataKey="rsi14"
              stroke={SERIES.s1}
              strokeWidth={2}
              dot={false}
              activeDot={ACTIVE_DOT}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-[11px] text-muted-foreground">
        Dashed lines mark the 70 (overbought) and 30 (oversold) thresholds.
      </figcaption>
    </figure>
  );
}

export function MacdChart({ data }: { data: ChartPoint[] }) {
  const visible = data.slice(-126);
  return (
    <figure aria-label="MACD (12, 26, 9) over six months">
      <ChartLegend
        className="mb-2"
        entries={[
          { label: "MACD", color: SERIES.s1 },
          { label: "Signal", color: SERIES.s2 },
          { label: "Histogram", color: SERIES.mid, shape: "rect" },
        ]}
      />
      <div className="h-36 w-full">
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 480, height: 144 }}
        >
          <ComposedChart data={visible} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
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
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={40}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <ReferenceLine y={0} stroke="var(--chart-axis)" />
            <Tooltip content={macdTooltip} cursor={CURSOR} />
            <Bar
              dataKey="macdHistogram"
              fill={SERIES.mid}
              fillOpacity={0.55}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="macd"
              stroke={SERIES.s1}
              strokeWidth={2}
              dot={false}
              activeDot={ACTIVE_DOT}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="macdSignal"
              stroke={SERIES.s2}
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
