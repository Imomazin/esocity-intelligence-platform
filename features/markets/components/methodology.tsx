import { DivergingBars } from "@/components/charts/diverging-bars";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPercent, formatSignedNumber } from "@/lib/format";
import type { CompositeSignal } from "@/lib/markets/types";

/** Full, transparent decomposition of the composite signal. */
export function SignalMethodology({ signal }: { signal: CompositeSignal }) {
  return (
    <div className="space-y-5">
      <DivergingBars
        ariaLabel="Contribution of each component to the composite score"
        limit={0.3}
        items={signal.components.map((component) => ({
          key: component.key,
          label: component.label,
          value: component.contribution,
          detail: component.interpretation,
        }))}
      />
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Component</TableHead>
            <TableHead className="hidden md:table-cell">Evidence</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="text-right">Weight</TableHead>
            <TableHead className="text-right">Contribution</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {signal.components.map((component) => (
            <TableRow key={component.key}>
              <TableCell className="align-top">
                <span className="font-medium">{component.label}</span>
                <span className="block text-xs whitespace-normal text-muted-foreground">
                  {component.interpretation}
                </span>
              </TableCell>
              <TableCell className="hidden align-top text-xs whitespace-normal text-muted-foreground md:table-cell">
                {component.value}
              </TableCell>
              <TableCell className="num text-right align-top">
                {formatSignedNumber(component.score, 2)}
              </TableCell>
              <TableCell className="num text-right align-top">
                {formatPercent(component.weight, 0)}
              </TableCell>
              <TableCell className="num text-right align-top font-semibold">
                {formatSignedNumber(component.contribution, 3)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-semibold">Composite score (Σ weight × score)</TableCell>
            <TableCell className="hidden md:table-cell" />
            <TableCell />
            <TableCell />
            <TableCell className="num text-right font-semibold">
              {formatSignedNumber(signal.score, 3)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {signal.explanation}
      </p>
    </div>
  );
}
