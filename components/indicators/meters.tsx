import { formatProbability } from "@/lib/format";
import { clamp } from "@/lib/quant/stats";
import { cn } from "@/lib/utils";

/**
 * Probability meter: a single-series bar. Fill in the primary series hue on a lighter step of
 * the same hue; the value is always printed as text (the bar never carries meaning alone).
 */
export function ProbabilityMeter({
  label,
  value,
  hint,
  className,
  emphasis = false,
}: {
  label: string;
  value: number;
  hint?: string;
  className?: string;
  emphasis?: boolean;
}) {
  const pct = clamp(value, 0, 1) * 100;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          {label}
          {hint && <span className="ml-1 text-[11px] text-muted-foreground/80">{hint}</span>}
        </span>
        <span className={cn("num font-semibold", emphasis && "text-base")}>
          {formatProbability(value)}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-series-1/15"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className="h-full rounded-full bg-series-1" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Compact inline confidence indicator (bar + percentage) for tables. */
export function InlineConfidence({ value, className }: { value: number; className?: string }) {
  const pct = clamp(value, 0, 1) * 100;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-series-1/15" aria-hidden>
        <span className="block h-full rounded-full bg-series-1" style={{ width: `${pct}%` }} />
      </span>
      <span className="num text-xs font-medium">{formatProbability(value)}</span>
    </span>
  );
}
