import { cn } from "@/lib/utils";

/**
 * Server-rendered SVG sparkline: de-emphasised trend line with the current value marked by an
 * end dot coloured by direction (with a 2px surface ring). Purely decorative — the numeric
 * value always appears beside it — so it is hidden from assistive technology.
 */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  className,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length < 2)
    return <span className={cn("inline-block", className)} style={{ width, height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const points = values.map((value, index) => {
    const x = pad + (index / (values.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const path = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const last = points[points.length - 1] as readonly [number, number];
  const rising = (values[values.length - 1] as number) >= (values[0] as number);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      aria-hidden
      focusable="false"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-muted-foreground/60"
      />
      <circle
        cx={last[0]}
        cy={last[1]}
        r={3}
        strokeWidth={2}
        className={cn("stroke-card", rising ? "fill-positive" : "fill-negative")}
      />
    </svg>
  );
}
