import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Stat tile: label (sentence case) · value (semibold, proportional figures) · optional delta
 * and footnote · optional trend visual.
 */
export function StatCard({
  label,
  value,
  delta,
  footnote,
  icon,
  trend,
  className,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  footnote?: ReactNode;
  icon?: ReactNode;
  trend?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-3 py-4", className)}>
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-2xl font-semibold tracking-tight">{value}</p>
            {(delta || footnote) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                {delta}
                {footnote && <span className="text-muted-foreground">{footnote}</span>}
              </div>
            )}
          </div>
          {trend && <div className="shrink-0">{trend}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
