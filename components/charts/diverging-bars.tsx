import { formatSignedNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface DivergingItem {
  key: string;
  label: string;
  value: number;
  detail?: string;
}

/**
 * Diverging bars around zero (blue ↔ red with a neutral axis), e.g. signal component
 * contributions. Signed values are always printed, so polarity never depends on colour.
 */
export function DivergingBars({
  items,
  limit = 1,
  className,
  ariaLabel,
  fractionDigits = 3,
}: {
  items: DivergingItem[];
  limit?: number;
  className?: string;
  ariaLabel: string;
  fractionDigits?: number;
}) {
  return (
    <ul className={cn("space-y-2", className)} aria-label={ariaLabel}>
      {items.map((item) => {
        const width = Math.min(1, Math.abs(item.value) / limit) * 50;
        const positive = item.value >= 0;
        return (
          <li
            key={item.key}
            className="grid grid-cols-[6.5rem_1fr_3.75rem] items-center gap-3 text-sm"
          >
            <span className="truncate text-muted-foreground" title={item.detail}>
              {item.label}
            </span>
            <span className="relative h-2.5 w-full" aria-hidden>
              <span className="absolute inset-y-[-3px] left-1/2 w-px bg-chart-axis" />
              <span
                className={cn(
                  "absolute inset-y-0",
                  positive
                    ? "left-1/2 rounded-r-[4px] bg-series-1"
                    : "right-1/2 rounded-l-[4px] bg-series-8",
                )}
                style={{ width: `${width}%` }}
              />
            </span>
            <span className="num text-right text-xs font-semibold">
              {formatSignedNumber(item.value, fractionDigits)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
