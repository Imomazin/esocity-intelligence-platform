import { Check, X } from "lucide-react";
import Link from "next/link";

import { RiskBadge } from "@/components/indicators/badges";
import { OutcomeBar } from "@/components/indicators/outcome-bar";
import type { MatchSummary } from "@/features/sports/types";
import { formatProbability, formatTimeUtc, formatWeekdayDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** One fixture/result with its 1X2 probability bar. */
export function MatchRow({ match, compact = false }: { match: MatchSummary; compact?: boolean }) {
  const finished = match.status === "finished" && match.score;
  return (
    <Link
      href={`/sports/match/${match.id}`}
      className="group grid gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary/40 focus-visible:outline-2 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-center"
    >
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground/80">{match.competition.shortName}</span>
          <span>R{match.round}</span>
          <span aria-hidden>·</span>
          <span>{formatWeekdayDate(match.kickoffAt)}</span>
          <span>{formatTimeUtc(match.kickoffAt)}</span>
          {match.status === "live" && (
            <span className="rounded bg-status-critical/15 px-1.5 font-semibold text-foreground">
              In play
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={cn("min-w-0 flex-1 truncate font-semibold group-hover:text-primary")}>
            {match.home.name}
          </span>
          {finished ? (
            <span className="num rounded-md bg-muted px-2 py-0.5 font-semibold">
              {match.score?.home}–{match.score?.away}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">v</span>
          )}
          <span className="min-w-0 flex-1 truncate text-right font-semibold group-hover:text-primary">
            {match.away.name}
          </span>
        </div>
      </div>
      <div className="min-w-0 space-y-1.5">
        <OutcomeBar
          home={match.prediction.home}
          draw={match.prediction.draw}
          away={match.prediction.away}
          homeLabel={match.home.code}
          awayLabel={match.away.code}
          size={compact ? "sm" : "md"}
          showLegend={!compact}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            xG{" "}
            <span className="num font-medium text-foreground">
              {match.prediction.lambdaHome.toFixed(2)}–{match.prediction.lambdaAway.toFixed(2)}
            </span>
          </span>
          <span>
            O2.5{" "}
            <span className="num font-medium text-foreground">
              {formatProbability(match.prediction.over25)}
            </span>
          </span>
          {!compact && (
            <RiskBadge
              level={match.prediction.uncertainty}
              suffix="uncertainty"
              className="py-0 text-[10px]"
            />
          )}
          {finished && match.outcomeCorrect !== null && (
            <span className="inline-flex items-center gap-1">
              {match.outcomeCorrect ? (
                <Check className="size-3 text-positive" aria-hidden />
              ) : (
                <X className="size-3 text-negative" aria-hidden />
              )}
              {match.outcomeCorrect ? "Most likely outcome occurred" : "Outcome differed"}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
