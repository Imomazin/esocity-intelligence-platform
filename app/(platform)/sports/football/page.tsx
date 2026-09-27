import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Disclaimer } from "@/components/data/disclaimer";
import { EmptyState } from "@/components/data/empty-state";
import { SectionCard } from "@/components/data/section-card";
import { PageHeader } from "@/components/layout/page-header";
import { MatchRow } from "@/features/sports/components/match-row";
import { StandingsTable } from "@/features/sports/components/standings-table";
import { getFootballFixtures } from "@/features/sports/queries";
import type { MatchSummary } from "@/features/sports/types";
import { formatWeekdayDate } from "@/lib/format";
import { getSportsDataProvider } from "@/lib/sports/providers";
import { siteConfig } from "@/lib/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Football",
  description: "Football fixtures, results, standings and model probabilities.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function groupByDay(matches: MatchSummary[]): [string, MatchSummary[]][] {
  const groups = new Map<string, MatchSummary[]>();
  for (const match of matches) {
    const day = match.kickoffAt.slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), match]);
  }
  return [...groups.entries()];
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

export default async function FootballPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const competition = typeof params.competition === "string" ? params.competition : undefined;
  const view = params.view === "results" ? "results" : "upcoming";
  const { competitions, matches } = await getFootballFixtures({ competition, view });
  const activeCompetition = competitions.find((entry) => entry.key === competition);
  const standings = activeCompetition
    ? await getSportsDataProvider().getStandings(activeCompetition.key)
    : null;

  const query = (next: { competition?: string; view?: string }) => {
    const search = new URLSearchParams();
    const c = next.competition ?? activeCompetition?.key;
    const v = next.view ?? view;
    if (c) search.set("competition", c);
    if (v !== "upcoming") search.set("view", v);
    const qs = search.toString();
    return `/sports/football${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Esocity Sports · Football"
        title="Fixtures & results"
        description="Every fixture carries pre-match probabilities; finished matches show how the model's view compared with the result."
      />

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Competition" className="inline-flex rounded-lg bg-muted p-[3px]">
          <FilterLink href={query({ competition: "" })} active={!activeCompetition}>
            All competitions
          </FilterLink>
          {competitions.map((entry) => (
            <FilterLink
              key={entry.key}
              href={query({ competition: entry.key })}
              active={activeCompetition?.key === entry.key}
            >
              {entry.name}
            </FilterLink>
          ))}
        </nav>
        <nav aria-label="View" className="inline-flex rounded-lg bg-muted p-[3px]">
          <FilterLink href={query({ view: "upcoming" })} active={view === "upcoming"}>
            Upcoming
          </FilterLink>
          <FilterLink href={query({ view: "results" })} active={view === "results"}>
            Results
          </FilterLink>
        </nav>
      </div>

      <div className={cn("grid gap-4", standings && "xl:grid-cols-[1fr_26rem]")}>
        <div className="space-y-5">
          {matches.length === 0 ? (
            <EmptyState title={view === "results" ? "No results yet" : "No upcoming fixtures"} />
          ) : (
            groupByDay(matches).map(([day, dayMatches]) => (
              <section key={day} aria-labelledby={`day-${day}`} className="space-y-2">
                <h2
                  id={`day-${day}`}
                  className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  {formatWeekdayDate(`${day}T12:00:00Z`)}
                </h2>
                {dayMatches.map((match) => (
                  <MatchRow key={match.id} match={match} />
                ))}
              </section>
            ))
          )}
        </div>
        {standings && activeCompetition && (
          <SectionCard
            title={`${activeCompetition.name} table`}
            description={activeCompetition.season}
            contentClassName="px-0"
          >
            <StandingsTable rows={standings} />
          </SectionCard>
        )}
      </div>

      <Disclaimer>{siteConfig.sportsDisclaimer}</Disclaimer>
    </div>
  );
}
