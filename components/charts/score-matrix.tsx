import { cn } from "@/lib/utils";

/**
 * Correct-score probability heatmap (home goals × away goals). Single-hue sequential scale that
 * flips its anchor in dark mode; label ink is chosen from the fill so text always clears
 * contrast. Rendered as a real table, so every value is available to assistive technology.
 */
export function ScoreMatrix({
  matrix,
  homeLabel,
  awayLabel,
  className,
}: {
  matrix: number[][];
  homeLabel: string;
  awayLabel: string;
  className?: string;
}) {
  const max = Math.max(...matrix.flat());
  let best = { h: 0, a: 0, p: -1 };
  matrix.forEach((row, h) =>
    row.forEach((p, a) => {
      if (p > best.p) best = { h, a, p };
    }),
  );
  const goals = matrix[0]?.map((_, index) => index) ?? [];

  return (
    <div className={cn("space-y-3", className)}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] border-separate border-spacing-0.5 text-center">
          <caption className="sr-only">
            Probability of each final score. Rows: {homeLabel} goals. Columns: {awayLabel} goals.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="w-16 p-1 text-left text-[10px] font-medium text-muted-foreground"
              >
                <span className="block">{homeLabel} ↓</span>
                <span className="block">{awayLabel} →</span>
              </th>
              {goals.map((goal) => (
                <th
                  key={goal}
                  scope="col"
                  className="p-1 text-xs font-semibold text-muted-foreground"
                >
                  {goal}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, h) => (
              <tr key={h}>
                <th
                  scope="row"
                  className="p-1 text-left text-xs font-semibold text-muted-foreground"
                >
                  {h}
                </th>
                {row.map((p, a) => {
                  const intensity = max > 0 ? p / max : 0;
                  const isBest = h === best.h && a === best.a;
                  return (
                    <td
                      key={a}
                      title={`${h}–${a}: ${(p * 100).toFixed(2)}%`}
                      className={cn(
                        "num h-9 rounded-[4px] text-[11px] font-medium",
                        isBest && "ring-2 ring-foreground ring-offset-1 ring-offset-card",
                      )}
                      style={{
                        backgroundColor: `color-mix(in oklab, var(--heat-high) ${(intensity * 100).toFixed(1)}%, var(--heat-low))`,
                        color: intensity > 0.55 ? "var(--heat-ink-high)" : "var(--heat-ink-low)",
                      }}
                    >
                      {p >= 0.005 ? (p * 100).toFixed(1) : <span className="opacity-50">·</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>0%</span>
        <span
          className="h-2 w-40 rounded-full"
          style={{ background: "linear-gradient(90deg, var(--heat-low), var(--heat-high))" }}
          aria-hidden
        />
        <span>{(max * 100).toFixed(1)}%</span>
        <span className="ml-auto">Values in %, · &lt; 0.5%. Ring = most likely score.</span>
      </div>
    </div>
  );
}
