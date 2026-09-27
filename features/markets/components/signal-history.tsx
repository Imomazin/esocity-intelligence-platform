import { ArrowRight } from "lucide-react";

import { EmptyState } from "@/components/data/empty-state";
import { Delta } from "@/components/data/delta";
import { SignalBadge } from "@/components/indicators/badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate, formatSignedNumber } from "@/lib/format";
import type { SignalChange } from "@/lib/markets/types";

export function SignalHistoryTable({ history }: { history: SignalChange[] }) {
  if (history.length === 0) {
    return (
      <EmptyState
        title="No signal changes in the last year"
        description="The signal has held a single state throughout the window."
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Date</TableHead>
          <TableHead>Change</TableHead>
          <TableHead className="text-right">Score</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right">Return since</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {history.map((change) => (
          <TableRow key={change.date}>
            <TableCell className="num">{formatDate(change.date)}</TableCell>
            <TableCell>
              <span className="inline-flex items-center gap-1.5">
                {change.from ? (
                  <SignalBadge signal={change.from} />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
                <ArrowRight className="size-3.5 text-muted-foreground" aria-label="changed to" />
                <SignalBadge signal={change.to} />
              </span>
            </TableCell>
            <TableCell className="num text-right">{formatSignedNumber(change.score, 2)}</TableCell>
            <TableCell className="num text-right">{formatCurrency(change.price)}</TableCell>
            <TableCell className="text-right">
              <Delta value={change.returnSince} fractionDigits={1} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
