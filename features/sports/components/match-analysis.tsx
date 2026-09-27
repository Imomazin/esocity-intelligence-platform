import type { ReactNode } from "react";

import { FormGuide } from "@/components/indicators/form-guide";
import { ProbabilityMeter } from "@/components/indicators/meters";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatProbability } from "@/lib/format";
import type {
  GoalMarkets,
  LambdaFactor,
  Match,
  MatchPrediction,
  TeamMatchContext,
} from "@/lib/sports/types";

const INJURY_LABEL = {
  none: "Full squad",
  minor: "Minor absences",
  moderate: "Several absences",
  major: "Major absences",
} as const;

/** Side-by-side pre-match inputs for both teams. */
export function TeamComparison({
  match,
  context,
}: {
  match: Match;
  context: { home: TeamMatchContext; away: TeamMatchContext };
}) {
  const rows: { label: string; hint?: string; home: ReactNode; away: ReactNode }[] = [
    {
      label: "League position",
      home: context.home.leaguePosition ?? "—",
      away: context.away.leaguePosition ?? "—",
    },
    {
      label: "Form (last five)",
      home: <FormGuide form={context.home.form} />,
      away: <FormGuide form={context.away.form} />,
    },
    {
      label: "Attack rating",
      hint: "1.00 = league average",
      home: context.home.attackRating.toFixed(2),
      away: context.away.attackRating.toFixed(2),
    },
    {
      label: "Defence rating",
      hint: "lower concedes less",
      home: context.home.defenceRating.toFixed(2),
      away: context.away.defenceRating.toFixed(2),
    },
    {
      label: "xG for (avg, last 5)",
      home: context.home.xgFor?.toFixed(2) ?? "—",
      away: context.away.xgFor?.toFixed(2) ?? "—",
    },
    {
      label: "xG against (avg, last 5)",
      home: context.home.xgAgainst?.toFixed(2) ?? "—",
      away: context.away.xgAgainst?.toFixed(2) ?? "—",
    },
    {
      label: "Availability",
      home: INJURY_LABEL[context.home.injuries],
      away: INJURY_LABEL[context.away.injuries],
    },
    {
      label: "Rest",
      home: context.home.restDays === null ? "—" : `${context.home.restDays} days`,
      away: context.away.restDays === null ? "—" : `${context.away.restDays} days`,
    },
  ];
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-1/3">{match.homeTeam.shortName}</TableHead>
          <TableHead className="w-1/3 text-center">Input</TableHead>
          <TableHead className="w-1/3 text-right">{match.awayTeam.shortName}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.label}>
            <TableCell className="num font-medium">{row.home}</TableCell>
            <TableCell className="text-center text-xs text-muted-foreground">
              {row.label}
              {row.hint && <span className="block text-[10px]">{row.hint}</span>}
            </TableCell>
            <TableCell className="num text-right font-medium">
              <span className="inline-flex justify-end">{row.away}</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Multiplicative derivation of each side's expected goals — the model shown in full. */
export function LambdaDerivation({
  factors,
  prediction,
}: {
  factors: LambdaFactor[];
  prediction: MatchPrediction;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Factor</TableHead>
          <TableHead className="text-right">Home ×</TableHead>
          <TableHead className="text-right">Away ×</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {factors.map((factor) => (
          <TableRow key={factor.key}>
            <TableCell>
              <span className="font-medium">{factor.label}</span>
              <span className="block text-xs whitespace-normal text-muted-foreground">
                {factor.description}
              </span>
            </TableCell>
            <TableCell className="num text-right align-top">{factor.home.toFixed(3)}</TableCell>
            <TableCell className="num text-right align-top">{factor.away.toFixed(3)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="font-semibold">Expected goals λ (product)</TableCell>
          <TableCell className="num text-right font-semibold">
            {prediction.lambdaHome.toFixed(2)}
          </TableCell>
          <TableCell className="num text-right font-semibold">
            {prediction.lambdaAway.toFixed(2)}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

export function GoalsMarkets({
  markets,
  homeName,
  awayName,
}: {
  markets: GoalMarkets;
  homeName: string;
  awayName: string;
}) {
  return (
    <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      <ProbabilityMeter label="Over 1.5 goals" value={markets.over15} />
      <ProbabilityMeter label="Over 2.5 goals" value={markets.over25} />
      <ProbabilityMeter label="Over 3.5 goals" value={markets.over35} />
      <ProbabilityMeter label="Under 2.5 goals" value={markets.under25} />
      <ProbabilityMeter label="Both teams to score" value={markets.bttsYes} />
      <ProbabilityMeter label="Both teams to score — no" value={markets.bttsNo} />
      <ProbabilityMeter label={`${homeName} clean sheet`} value={markets.cleanSheetHome} />
      <ProbabilityMeter label={`${awayName} clean sheet`} value={markets.cleanSheetAway} />
    </div>
  );
}

export function TopScorelines({
  prediction,
  homeCode,
  awayCode,
}: {
  prediction: MatchPrediction;
  homeCode: string;
  awayCode: string;
}) {
  return (
    <ol className="space-y-2">
      {prediction.topScorelines.map((scoreline, index) => (
        <li key={`${scoreline.home}-${scoreline.away}`} className="flex items-center gap-3 text-sm">
          <span className="w-4 text-xs text-muted-foreground">{index + 1}</span>
          <span className="num w-20 font-semibold">
            {homeCode} {scoreline.home}–{scoreline.away} {awayCode}
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-r-[4px] bg-muted/60" aria-hidden>
            <span
              className="block h-full rounded-r-[4px] bg-series-1"
              style={{
                width: `${(scoreline.probability / (prediction.topScorelines[0]?.probability || 1)) * 100}%`,
              }}
            />
          </span>
          <span className="num w-12 text-right text-xs font-medium">
            {formatProbability(scoreline.probability, 1)}
          </span>
        </li>
      ))}
    </ol>
  );
}
