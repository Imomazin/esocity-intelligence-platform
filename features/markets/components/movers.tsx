import Link from "next/link";

import { Delta } from "@/components/data/delta";
import type { AssetSummary } from "@/features/markets/types";
import { formatCurrency } from "@/lib/format";

function MoverList({
  title,
  assets,
  empty,
}: {
  title: string;
  assets: AssetSummary[];
  empty: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {assets.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {assets.map((asset) => (
            <li key={asset.symbol}>
              <Link
                href={`/markets/${asset.symbol}`}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/50"
              >
                <span className="font-semibold">{asset.symbol}</span>
                <span className="num text-muted-foreground">{formatCurrency(asset.price)}</span>
                <Delta value={asset.changePercent} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Movers({ gainers, losers }: { gainers: AssetSummary[]; losers: AssetSummary[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
      <MoverList title="Top gainers" assets={gainers} empty="No advancers this session." />
      <MoverList title="Top decliners" assets={losers} empty="No decliners this session." />
    </div>
  );
}
