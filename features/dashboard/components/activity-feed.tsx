import { ArrowLeftRight, ChartCandlestick, Trophy } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/data/empty-state";
import type { ActivityItem } from "@/features/dashboard/queries";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICONS = { order: ArrowLeftRight, signal: ChartCandlestick, match: Trophy } as const;

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <EmptyState title="No recent activity" />;
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {items.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <li key={item.id} className="relative">
            <span className="absolute top-0.5 -left-[1.95rem] flex size-6 items-center justify-center rounded-full border bg-card">
              <Icon
                className={cn(
                  "size-3",
                  item.tone === "positive"
                    ? "text-positive"
                    : item.tone === "negative"
                      ? "text-negative"
                      : "text-muted-foreground",
                )}
                aria-hidden
              />
            </span>
            <Link href={item.href} className="block rounded-sm hover:text-primary">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="text-xs text-muted-foreground">{item.detail}</p>
              <p className="num text-[11px] text-muted-foreground">{formatDate(item.at)}</p>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
