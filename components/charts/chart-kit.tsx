"use client";

import { Table2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { TooltipContentProps, TooltipValueType } from "recharts";

import { BarChart3Fallback } from "@/components/charts/chart-icons";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePreferences } from "@/lib/hooks/use-preferences";
import { cn } from "@/lib/utils";

/** Shared Recharts styling so every chart reads as one system. */
export const AXIS_TICK = { fill: "var(--chart-text)", fontSize: 11 } as const;
export const AXIS_LINE = { stroke: "var(--chart-axis)" } as const;
export const GRID_STROKE = "var(--chart-grid)";
export const CURSOR = { stroke: "var(--chart-axis)", strokeWidth: 1 } as const;
export const ACTIVE_DOT = { r: 4, strokeWidth: 2, stroke: "var(--chart-surface)" } as const;

export const SERIES = {
  s1: "var(--series-1)",
  s2: "var(--series-2)",
  s3: "var(--series-3)",
  s4: "var(--series-4)",
  s8: "var(--series-8)",
  mid: "var(--diverging-mid)",
  critical: "var(--status-critical)",
} as const;

/** Tooltip props with Recharts' default generics (what `<Tooltip content>` passes). */
export type ChartTooltipProps = TooltipContentProps<TooltipValueType, string | number>;

export interface TooltipRow {
  key: string;
  label: string;
  color: string;
  format: (value: number) => string;
}

/**
 * Tooltip content: values lead (strong), series names follow; each row keyed with a short line
 * in the series colour. Rendered with React text nodes (never innerHTML).
 */
export function makeTooltip(rows: TooltipRow[], formatLabel: (label: string) => string) {
  return function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
    if (!active || !payload?.length) return null;
    const datum = payload[0]?.payload as Record<string, unknown> | undefined;
    return (
      <div className="min-w-40 rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
        <p className="mb-1.5 font-medium text-muted-foreground">{formatLabel(String(label))}</p>
        <ul className="space-y-1">
          {rows.map((row) => {
            const value = datum?.[row.key];
            if (typeof value !== "number") return null;
            return (
              <li key={row.key} className="flex items-center gap-2">
                <span
                  className="h-0.5 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                  aria-hidden
                />
                <span className="num font-semibold text-foreground">{row.format(value)}</span>
                <span className="text-muted-foreground">{row.label}</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };
}

export interface LegendEntry {
  label: string;
  color: string;
  shape?: "line" | "rect";
}

export function ChartLegend({
  entries,
  className,
}: {
  entries: LegendEntry[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {entries.map((entry) => (
        <li key={entry.label} className="inline-flex items-center gap-1.5">
          <span
            className={
              entry.shape === "rect" ? "size-2.5 rounded-[2px]" : "h-0.5 w-3.5 rounded-full"
            }
            style={{ backgroundColor: entry.color }}
            aria-hidden
          />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Chart frame with a Chart / Table toggle — every chart has a table-view twin so no value is
 * reachable only through hover.
 */
export function ChartFrame({
  chart,
  table,
  toolbar,
  legend,
  className,
}: {
  chart: ReactNode;
  table: ReactNode;
  toolbar?: ReactNode;
  legend?: ReactNode;
  className?: string;
}) {
  const [preferences] = usePreferences();
  // null = follow the user's saved preference until they toggle this particular chart.
  const [override, setView] = useState<"chart" | "table" | null>(null);
  const view = override ?? (preferences.preferTables ? "table" : "chart");
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">{toolbar}</div>
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(value) => value && setView(value as "chart" | "table")}
          aria-label="Chart or table view"
        >
          <ToggleGroupItem value="chart" aria-label="Chart view">
            <BarChart3Fallback />
          </ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="Table view">
            <Table2 />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {view === "chart" ? (
        <>
          {legend}
          {chart}
        </>
      ) : (
        <div className="max-h-80 overflow-auto rounded-md border">{table}</div>
      )}
    </div>
  );
}
