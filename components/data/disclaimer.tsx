import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Compact, always-visible disclaimer line used beneath probabilistic outputs. */
export function Disclaimer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 text-xs leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function DataSourceNote({
  simulated,
  asOf,
  source,
  className,
}: {
  simulated: boolean;
  asOf?: string;
  source: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="font-medium text-foreground">
        {simulated ? "Simulated data" : "Licensed data"}
      </span>
      <span aria-hidden>·</span>
      <span>{source}</span>
      {asOf && (
        <>
          <span aria-hidden>·</span>
          <span>{asOf}</span>
        </>
      )}
    </span>
  );
}
