import { FormGuide } from "@/components/indicators/form-guide";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StandingRow } from "@/lib/sports/types";

export function StandingsTable({
  rows,
  compact = false,
}: {
  rows: StandingRow[];
  compact?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-8">#</TableHead>
          <TableHead>Club</TableHead>
          <TableHead className="text-right">P</TableHead>
          {!compact && <TableHead className="hidden text-right sm:table-cell">W</TableHead>}
          {!compact && <TableHead className="hidden text-right sm:table-cell">D</TableHead>}
          {!compact && <TableHead className="hidden text-right sm:table-cell">L</TableHead>}
          <TableHead className="text-right">GD</TableHead>
          <TableHead className="text-right">Pts</TableHead>
          {!compact && <TableHead className="hidden md:table-cell">Form</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody className="num">
        {rows.map((row) => (
          <TableRow key={row.team.key}>
            <TableCell className="text-muted-foreground">{row.position}</TableCell>
            <TableCell className="font-medium">
              {compact ? row.team.shortName : row.team.name}
            </TableCell>
            <TableCell className="text-right">{row.played}</TableCell>
            {!compact && (
              <TableCell className="hidden text-right sm:table-cell">{row.won}</TableCell>
            )}
            {!compact && (
              <TableCell className="hidden text-right sm:table-cell">{row.drawn}</TableCell>
            )}
            {!compact && (
              <TableCell className="hidden text-right sm:table-cell">{row.lost}</TableCell>
            )}
            <TableCell className="text-right">
              {row.goalDifference > 0 ? "+" : row.goalDifference < 0 ? "−" : ""}
              {Math.abs(row.goalDifference)}
            </TableCell>
            <TableCell className="text-right font-semibold">{row.points}</TableCell>
            {!compact && (
              <TableCell className="hidden md:table-cell">
                <FormGuide form={row.form} />
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
