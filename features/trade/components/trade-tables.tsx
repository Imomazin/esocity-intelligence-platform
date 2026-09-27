import { Check, X } from "lucide-react";
import Link from "next/link";

import { Delta } from "@/components/data/delta";
import { EmptyState } from "@/components/data/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatCurrency,
  formatDate,
  formatDateTimeUtc,
  formatPercent,
  formatSignedCurrency,
} from "@/lib/format";
import type { ClosedPosition, PaperOrder, Position } from "@/lib/trade/types";
import { cn } from "@/lib/utils";

export function PositionsTable({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return (
      <EmptyState
        title="No open positions"
        description="Place a paper BUY order to open a position."
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Symbol</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Avg cost</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right">Market value</TableHead>
          <TableHead className="text-right">Unrealised P&amp;L</TableHead>
          <TableHead className="hidden text-right md:table-cell">Day</TableHead>
          <TableHead className="hidden text-right lg:table-cell">Weight</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((position) => (
          <TableRow key={position.symbol}>
            <TableCell>
              <Link
                href={`/markets/${position.symbol}`}
                className="font-semibold hover:text-primary"
              >
                {position.symbol}
              </Link>
            </TableCell>
            <TableCell className="num text-right">{position.quantity}</TableCell>
            <TableCell className="num hidden text-right sm:table-cell">
              {formatCurrency(position.averageCost)}
            </TableCell>
            <TableCell className="num text-right">{formatCurrency(position.marketPrice)}</TableCell>
            <TableCell className="num text-right font-medium">
              {formatCurrency(position.marketValue)}
            </TableCell>
            <TableCell className="text-right">
              <span className="flex flex-col items-end">
                <Delta value={position.unrealizedPnl} format="currency" showIcon={false} />
                <Delta value={position.unrealizedPnlPercent} className="text-[11px]" />
              </span>
            </TableCell>
            <TableCell className="hidden text-right md:table-cell">
              <Delta value={position.dayChangePercent} />
            </TableCell>
            <TableCell className="num hidden text-right lg:table-cell">
              {formatPercent(position.weight, 1)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function OrdersTable({ orders, limit = 25 }: { orders: PaperOrder[]; limit?: number }) {
  if (orders.length === 0) {
    return (
      <EmptyState title="No orders yet" description="Your paper order history will appear here." />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Time (UTC)</TableHead>
          <TableHead>Order</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Fill</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Fee</TableHead>
          <TableHead className="hidden text-right md:table-cell">Notional</TableHead>
          <TableHead className="hidden text-right lg:table-cell">Realised P&amp;L</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.slice(0, limit).map((order) => (
          <TableRow key={order.id}>
            <TableCell className="num text-xs text-muted-foreground">
              {formatDateTimeUtc(order.requestedAt).replace(" UTC", "")}
            </TableCell>
            <TableCell>
              <span
                className={cn(
                  "font-semibold",
                  order.side === "BUY" ? "text-positive" : "text-negative",
                )}
              >
                {order.side === "BUY" ? "Buy" : "Sell"}
              </span>{" "}
              <span className="num">{order.quantity}</span>{" "}
              <span className="font-medium">{order.symbol}</span>
              {order.source === "seed" && (
                <span className="ml-1.5 text-[10px] text-muted-foreground">demo</span>
              )}
            </TableCell>
            <TableCell>
              {order.status === "FILLED" ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium">
                  <Check className="size-3.5 text-status-good" aria-hidden /> Filled
                </span>
              ) : (
                <span
                  className="inline-flex max-w-60 items-start gap-1 text-xs font-medium whitespace-normal"
                  title={order.rejectionMessage ?? undefined}
                >
                  <X className="mt-0.5 size-3.5 shrink-0 text-status-critical" aria-hidden />
                  <span>
                    Rejected
                    <span className="block font-normal text-muted-foreground">
                      {order.rejectionReason?.replaceAll("_", " ").toLowerCase()}
                    </span>
                  </span>
                </span>
              )}
            </TableCell>
            <TableCell className="num text-right">
              {order.fillPrice === null ? "—" : formatCurrency(order.fillPrice)}
            </TableCell>
            <TableCell className="num hidden text-right sm:table-cell">
              {order.fee ? formatCurrency(order.fee) : "—"}
            </TableCell>
            <TableCell className="num hidden text-right md:table-cell">
              {order.notional === null ? "—" : formatCurrency(order.notional)}
            </TableCell>
            <TableCell className="hidden text-right lg:table-cell">
              {order.realizedPnl === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <Delta value={order.realizedPnl} format="currency" showIcon={false} />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ClosedPositionsTable({ closed }: { closed: ClosedPosition[] }) {
  if (closed.length === 0) {
    return (
      <EmptyState
        title="No closed positions"
        description="Fully exited positions and their realised P&L appear here."
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Symbol</TableHead>
          <TableHead className="text-right">Units sold</TableHead>
          <TableHead className="text-right">Realised P&amp;L</TableHead>
          <TableHead className="text-right">Closed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {closed.map((position) => (
          <TableRow key={position.symbol}>
            <TableCell className="font-semibold">{position.symbol}</TableCell>
            <TableCell className="num text-right">{position.quantityTraded}</TableCell>
            <TableCell className="text-right">
              <span
                className={cn(
                  "num font-medium",
                  position.realizedPnl >= 0 ? "text-positive" : "text-negative",
                )}
              >
                {formatSignedCurrency(position.realizedPnl)}
              </span>
            </TableCell>
            <TableCell className="num text-right text-muted-foreground">
              {formatDate(position.closedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
