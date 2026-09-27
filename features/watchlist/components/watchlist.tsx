"use client";

import { Plus, Star, Trash } from "lucide-react";
import Link from "next/link";

import { Sparkline } from "@/components/charts/sparkline";
import { Delta } from "@/components/data/delta";
import { EmptyState } from "@/components/data/empty-state";
import { RegimeBadge, SignalBadge } from "@/components/indicators/badges";
import { InlineConfidence } from "@/components/indicators/meters";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AssetSummary } from "@/features/markets/types";
import { formatCurrency, formatProbability } from "@/lib/format";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";

export const DEFAULT_WATCHLIST: string[] = ["NVDA", "MSFT", "AAPL", "TSLA", "SPY"];
const STORAGE_KEY = "esocity:watchlist";

export function useWatchlist(): [string[], (symbols: string[]) => void] {
  return useLocalStorage<string[]>(STORAGE_KEY, DEFAULT_WATCHLIST);
}

/** Compact watchlist for the dashboard and markets overview. */
export function WatchlistCompact({
  assets,
  limit = 6,
}: {
  assets: AssetSummary[];
  limit?: number;
}) {
  const [symbols] = useWatchlist();
  const watched = symbols
    .map((symbol) => assets.find((asset) => asset.symbol === symbol))
    .filter((asset): asset is AssetSummary => Boolean(asset))
    .slice(0, limit);

  if (watched.length === 0) {
    return (
      <EmptyState
        icon={Star}
        title="Your watchlist is empty"
        description="Add assets from the Watchlist page to track them here."
        action={
          <Button size="sm" variant="outline" asChild>
            <Link href="/watchlist">Manage watchlist</Link>
          </Button>
        }
      />
    );
  }
  return (
    <ul className="divide-y">
      {watched.map((asset) => (
        <li key={asset.symbol}>
          <Link
            href={`/markets/${asset.symbol}`}
            className="grid grid-cols-[4rem_1fr_auto] items-center gap-3 py-2.5 text-sm hover:bg-muted/40 sm:grid-cols-[4rem_1fr_6rem_auto]"
          >
            <span className="font-semibold">{asset.symbol}</span>
            <span className="flex flex-col">
              <span className="num font-medium">{formatCurrency(asset.price)}</span>
              <Delta value={asset.changePercent} className="text-xs" />
            </span>
            <Sparkline values={asset.sparkline} width={88} className="hidden sm:block" />
            <SignalBadge signal={asset.signal} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Full watchlist manager: watched assets table plus add/remove for the whole universe. */
export function WatchlistManager({ assets }: { assets: AssetSummary[] }) {
  const [symbols, setSymbols] = useWatchlist();
  const watched = symbols
    .map((symbol) => assets.find((asset) => asset.symbol === symbol))
    .filter((asset): asset is AssetSummary => Boolean(asset));
  const available = assets.filter((asset) => !symbols.includes(asset.symbol));

  return (
    <div className="space-y-6">
      {watched.length === 0 ? (
        <EmptyState
          icon={Star}
          title="No assets on your watchlist"
          description="Add assets from the list below."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Asset</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="hidden md:table-cell">30D</TableHead>
              <TableHead>Signal</TableHead>
              <TableHead className="hidden sm:table-cell">Confidence</TableHead>
              <TableHead className="hidden text-right lg:table-cell">P(up)</TableHead>
              <TableHead className="hidden lg:table-cell">Regime</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {watched.map((asset) => (
              <TableRow key={asset.symbol}>
                <TableCell>
                  <Link
                    href={`/markets/${asset.symbol}`}
                    className="flex flex-col hover:text-primary"
                  >
                    <span className="font-semibold">{asset.symbol}</span>
                    <span className="text-xs text-muted-foreground">{asset.name}</span>
                  </Link>
                </TableCell>
                <TableCell className="num text-right font-medium">
                  {formatCurrency(asset.price)}
                </TableCell>
                <TableCell className="text-right">
                  <Delta value={asset.changePercent} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Sparkline values={asset.sparkline} />
                </TableCell>
                <TableCell>
                  <SignalBadge signal={asset.signal} />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <InlineConfidence value={asset.confidence} />
                </TableCell>
                <TableCell className="num hidden text-right lg:table-cell">
                  {formatProbability(asset.probabilityUp)}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <RegimeBadge regime={asset.regime} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${asset.symbol} from watchlist`}
                    onClick={() => setSymbols(symbols.filter((symbol) => symbol !== asset.symbol))}
                  >
                    <Trash />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="space-y-3">
        <p className="text-sm font-medium">Add to watchlist</p>
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every asset in the demo universe is on your watchlist.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {available.map((asset) => (
              <Button
                key={asset.symbol}
                variant="outline"
                size="sm"
                onClick={() => setSymbols([...symbols, asset.symbol])}
                aria-label={`Add ${asset.symbol} to watchlist`}
              >
                <Plus /> {asset.symbol}
              </Button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Watchlists are saved in this browser for the demo. With production authentication they
        persist to the
        <code className="mx-1 rounded bg-muted px-1 font-mono">watchlists</code>table.
      </p>
    </div>
  );
}
