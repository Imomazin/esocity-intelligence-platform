import { formatProbability } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Home / Draw / Away probability bar. Encoded as a diverging pair (home = blue, away = orange)
 * with a neutral grey midpoint for the draw, separated by 2px surface gaps. Values are direct-
 * labelled inside segments that fit and always listed in the legend beneath (no colour-only
 * reading, no tooltip-only values).
 */
export function OutcomeBar({
  home,
  draw,
  away,
  homeLabel = "Home",
  awayLabel = "Away",
  showLegend = true,
  size = "md",
  className,
}: {
  home: number;
  draw: number;
  away: number;
  homeLabel?: string;
  awayLabel?: string;
  showLegend?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const segments = [
    {
      key: "home",
      label: homeLabel,
      value: home,
      className: "bg-outcome-home",
      ink: "text-on-outcome-home",
    },
    {
      key: "draw",
      label: "Draw",
      value: draw,
      className: "bg-diverging-mid",
      ink: "text-on-outcome-draw",
    },
    {
      key: "away",
      label: awayLabel,
      value: away,
      className: "bg-outcome-away",
      ink: "text-on-outcome-away",
    },
  ];
  const summary = `${homeLabel} ${formatProbability(home)}, draw ${formatProbability(draw)}, ${awayLabel} ${formatProbability(away)}`;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        role="img"
        aria-label={`Outcome probabilities: ${summary}`}
        className={cn(
          "flex w-full gap-0.5 overflow-hidden rounded-md",
          size === "sm" ? "h-2" : "h-6",
        )}
      >
        {segments.map((segment) => (
          <div
            key={segment.key}
            className={cn("flex items-center justify-center", segment.className)}
            style={{ width: `${Math.max(segment.value * 100, 1)}%` }}
            title={`${segment.label}: ${formatProbability(segment.value, 1)}`}
          >
            {size === "md" && segment.value >= 0.14 && (
              <span className={cn("num text-[11px] font-semibold", segment.ink)}>
                {formatProbability(segment.value)}
              </span>
            )}
          </div>
        ))}
      </div>
      {showLegend && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          {segments.map((segment) => (
            <span key={segment.key} className="inline-flex min-w-0 items-center gap-1.5">
              <span
                className={cn("size-2 shrink-0 rounded-[2px]", segment.className)}
                aria-hidden
              />
              <span className="truncate">{segment.label}</span>
              <span className="num font-medium text-foreground">
                {formatProbability(segment.value)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
