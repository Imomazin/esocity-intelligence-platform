import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface BarListItem {
  key: string;
  label: string;
  value: number;
  display?: string;
  /** Visually distinguish a reference row (e.g. cash) with the neutral grey. */
  muted?: boolean;
}

/**
 * Horizontal bar list (single series, one hue). Thin 8px bars with rounded data ends, values
 * printed as text at the bar tip. Used for exposure/allocation instead of a many-slice donut.
 */
export function BarList({
  items,
  max,
  className,
  ariaLabel,
}: {
  items: BarListItem[];
  max?: number;
  className?: string;
  ariaLabel: string;
}) {
  const ceiling = max ?? Math.max(...items.map((item) => item.value), 0.0001);
  return (
    <ul className={cn("space-y-2.5", className)} aria-label={ariaLabel}>
      {items.map((item) => (
        <li
          key={item.key}
          className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-3 text-sm"
        >
          <span className="truncate font-medium">{item.label}</span>
          <span className="h-2 w-full overflow-hidden rounded-r-[4px] bg-muted/60" aria-hidden>
            <span
              className={cn(
                "block h-full rounded-r-[4px]",
                item.muted ? "bg-diverging-mid" : "bg-series-1",
              )}
              style={{ width: `${Math.max(0, Math.min(1, item.value / ceiling)) * 100}%` }}
            />
          </span>
          <span className="num text-right text-xs font-medium">
            {item.display ?? formatPercent(item.value, 1)}
          </span>
        </li>
      ))}
    </ul>
  );
}
