import Link from "next/link";

import { Sparkline } from "@/components/charts/sparkline";
import { Delta } from "@/components/data/delta";
import { RegimeBadge, RiskBadge, SignalBadge } from "@/components/indicators/badges";
import { InlineConfidence } from "@/components/indicators/meters";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AssetSummary } from "@/features/markets/types";
import { formatCurrency, formatPercent, formatProbability } from "@/lib/format";

export function AssetTable({ assets, caption }: { assets: AssetSummary[]; caption?: string }) {
  return (
    <Table>
      {caption && <caption className="sr-only">{caption}</caption>}
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Asset</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right">Change</TableHead>
          <TableHead className="hidden md:table-cell">30D</TableHead>
          <TableHead>Signal</TableHead>
          <TableHead className="hidden sm:table-cell">Confidence</TableHead>
          <TableHead className="hidden text-right lg:table-cell">P(up, 20d)</TableHead>
          <TableHead className="hidden xl:table-cell">Regime</TableHead>
          <TableHead className="hidden text-right lg:table-cell">Vol 20D</TableHead>
          <TableHead className="hidden xl:table-cell">Risk</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assets.map((asset) => (
          <TableRow key={asset.symbol}>
            <TableCell>
              <Link
                href={`/markets/${asset.symbol}`}
                className="group flex flex-col rounded-sm focus-visible:outline-2"
              >
                <span className="font-semibold group-hover:text-primary">{asset.symbol}</span>
                <span className="max-w-44 truncate text-xs text-muted-foreground">
                  {asset.name}
                </span>
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
            <TableCell className="hidden xl:table-cell">
              <RegimeBadge regime={asset.regime} />
            </TableCell>
            <TableCell className="num hidden text-right lg:table-cell">
              {asset.volatility20 === null ? "—" : formatPercent(asset.volatility20, 1)}
            </TableCell>
            <TableCell className="hidden xl:table-cell">
              <RiskBadge level={asset.riskLevel} suffix="" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
