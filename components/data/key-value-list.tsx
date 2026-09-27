import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}

export function KeyValueList({
  items,
  className,
  columns = 1,
}: {
  items: KeyValueItem[];
  className?: string;
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-3 text-sm",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className="flex min-w-0 items-baseline justify-between gap-3 border-b border-dashed pb-2 last:border-0"
        >
          <dt className="min-w-0 text-muted-foreground">
            {item.label}
            {item.hint && (
              <span className="block text-[11px] text-muted-foreground/80">{item.hint}</span>
            )}
          </dt>
          <dd className="num shrink-0 text-right font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
