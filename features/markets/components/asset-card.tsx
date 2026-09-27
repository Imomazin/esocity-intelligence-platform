import Link from "next/link";

import { Sparkline } from "@/components/charts/sparkline";
import { Delta } from "@/components/data/delta";
import { SignalBadge } from "@/components/indicators/badges";
import type { AssetSummary } from "@/features/markets/types";
import { formatCurrency, formatProbability } from "@/lib/format";

export function AssetCard({ asset }: { asset: AssetSummary }) {
  return (
    <Link
      href={`/markets/${asset.symbol}`}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-primary/40 focus-visible:outline-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold group-hover:text-primary">{asset.symbol}</p>
          <p className="truncate text-xs text-muted-foreground">{asset.name}</p>
        </div>
        <SignalBadge signal={asset.signal} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-lg font-semibold">{formatCurrency(asset.price)}</p>
          <Delta value={asset.changePercent} className="text-xs" />
        </div>
        <Sparkline values={asset.sparkline} width={88} height={32} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Confidence{" "}
        <span className="num font-medium text-foreground">
          {formatProbability(asset.confidence)}
        </span>
        <span aria-hidden> · </span>P(up){" "}
        <span className="num font-medium text-foreground">
          {formatProbability(asset.probabilityUp)}
        </span>
      </p>
    </Link>
  );
}
