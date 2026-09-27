"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  AXIS_LINE,
  AXIS_TICK,
  ChartFrame,
  ChartLegend,
  GRID_STROKE,
  SERIES,
  type ChartTooltipProps,
} from "@/components/charts/chart-kit";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPercent } from "@/lib/format";

export interface CalibrationPointView {
  label: string;
  predicted: number;
  observed: number;
  count: number;
}

function CalibrationTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as CalibrationPointView | undefined;
  if (!point) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-muted-foreground">Predicted bin {point.label}</p>
      <p>
        <span className="num font-semibold">{formatPercent(point.observed, 1)}</span>{" "}
        <span className="text-muted-foreground">observed vs</span>{" "}
        <span className="num font-semibold">{formatPercent(point.predicted, 1)}</span>{" "}
        <span className="text-muted-foreground">predicted</span>
      </p>
      <p className="text-muted-foreground">{point.count.toLocaleString("en-US")} predictions</p>
    </div>
  );
}

/**
 * Reliability diagram: observed frequency vs mean predicted probability per bin. Points on the
 * dashed diagonal are perfectly calibrated; the axes share one scale so the diagonal is 45°.
 */
export function CalibrationChart({
  points,
  title,
}: {
  points: CalibrationPointView[];
  title: string;
}) {
  const values = points.flatMap((point) => [point.predicted, point.observed]);
  const lower = Math.max(0, Math.floor((Math.min(...values, 0.4) - 0.05) * 10) / 10);
  const upper = Math.min(1, Math.ceil((Math.max(...values, 0.6) + 0.05) * 10) / 10);
  const data = [...points].sort((a, b) => a.predicted - b.predicted);

  return (
    <ChartFrame
      legend={
        <ChartLegend
          entries={[
            { label: "Model", color: SERIES.s1 },
            { label: "Perfect calibration", color: "var(--chart-axis)" },
          ]}
        />
      }
      chart={
        <figure
          aria-label={`${title}: observed frequency against predicted probability`}
          className="h-60 w-full"
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 420, height: 240 }}
          >
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 16, left: 4 }}>
              <CartesianGrid stroke={GRID_STROKE} />
              <XAxis
                type="number"
                dataKey="predicted"
                domain={[lower, upper]}
                tickFormatter={(v: number) => formatPercent(v, 0)}
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                label={{
                  value: "Predicted",
                  position: "insideBottom",
                  offset: -10,
                  fill: "var(--chart-text)",
                  fontSize: 11,
                }}
              />
              <YAxis
                type="number"
                domain={[lower, upper]}
                tickFormatter={(v: number) => formatPercent(v, 0)}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <ReferenceLine
                segment={[
                  { x: lower, y: lower },
                  { x: upper, y: upper },
                ]}
                stroke="var(--chart-axis)"
                strokeDasharray="4 4"
              />
              <Tooltip content={CalibrationTooltip} cursor={false} />
              <Line
                type="linear"
                dataKey="observed"
                stroke={SERIES.s1}
                strokeWidth={2}
                dot={{ r: 4, strokeWidth: 2, stroke: "var(--chart-surface)", fill: SERIES.s1 }}
                activeDot={{
                  r: 6,
                  strokeWidth: 2,
                  stroke: "var(--chart-surface)",
                  fill: SERIES.s1,
                }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </figure>
      }
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bin</TableHead>
              <TableHead className="text-right">Predicted</TableHead>
              <TableHead className="text-right">Observed</TableHead>
              <TableHead className="text-right">Count</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="num">
            {data.map((point) => (
              <TableRow key={point.label}>
                <TableCell>{point.label}</TableCell>
                <TableCell className="text-right">{formatPercent(point.predicted, 1)}</TableCell>
                <TableCell className="text-right">{formatPercent(point.observed, 1)}</TableCell>
                <TableCell className="text-right">{point.count.toLocaleString("en-US")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    />
  );
}
