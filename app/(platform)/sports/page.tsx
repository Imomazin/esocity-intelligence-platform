import { CalendarDays, Crosshair, Target, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { CalibrationChart } from "@/components/charts/calibration-chart";
import { DataSourceNote, Disclaimer } from "@/components/data/disclaimer";
import { EmptyState } from "@/components/data/empty-state";
import { SectionCard } from "@/components/data/section-card";
import { StatCard } from "@/components/data/stat-card";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { MatchRow } from "@/features/sports/components/match-row";
import { StandingsTable } from "@/features/sports/components/standings-table";
import { getSportsOverview } from "@/features/sports/queries";
import { formatPercent } from "@/lib/format";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Sports",
  description: "Football match probabilities from a transparent Poisson / Dixon–Coles model.",
};

export const revalidate = 300;

export default async function SportsPage() {
  const overview = await getSportsOverview();
  const { evaluation } = overview;
  const calibration = evaluation.reliability
    .filter((bin) => bin.count > 0 && bin.meanPredicted !== null && bin.observedFrequency !== null)
    .map((bin) => ({
      label: `${Math.round(bin.lower * 100)}–${Math.round(bin.upper * 100)}%`,
      predicted: bin.meanPredicted as number,
      observed: bin.observedFrequency as number,
      count: bin.count,
    }));
  const topFavourite = [...overview.upcoming].sort(
    (a, b) =>
      Math.max(b.prediction.home, b.prediction.away) -
      Math.max(a.prediction.home, a.prediction.away),
  )[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Esocity Sports"
        title="Sports intelligence"
        description="Match probabilities, expected goals and scorelines from a transparent football model — analysis, not betting."
        meta={
          <DataSourceNote
            simulated={overview.provider.isSimulated}
            source={overview.provider.displayName}
          />
        }
        actions={
          <Button asChild>
            <Link href="/sports/football">
              <CalendarDays /> All fixtures
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Fixtures, next 10 days"
          icon={<CalendarDays />}
          value={overview.upcoming.length}
          footnote={`${overview.competitions.length} competitions`}
        />
        <StatCard
          label="1X2 accuracy (out-of-sample)"
          icon={<Target />}
          value={evaluation.accuracy === null ? "—" : formatPercent(evaluation.accuracy, 1)}
          footnote={`${evaluation.matches} finished matches`}
        />
        <StatCard
          label="Brier skill vs base rates"
          icon={<Crosshair />}
          value={
            evaluation.brierSkillScore === null
              ? "—"
              : `${evaluation.brierSkillScore > 0 ? "+" : ""}${formatPercent(evaluation.brierSkillScore, 1)}`
          }
          footnote={`Brier ${evaluation.brierScore?.toFixed(3) ?? "—"} vs ${evaluation.baselineBrierScore?.toFixed(3) ?? "—"}`}
        />
        <StatCard
          label="Strongest favourite"
          icon={<Trophy />}
          value={
            topFavourite
              ? formatPercent(
                  Math.max(topFavourite.prediction.home, topFavourite.prediction.away),
                  0,
                )
              : "—"
          }
          footnote={
            topFavourite
              ? `${topFavourite.home.shortName} v ${topFavourite.away.shortName}`
              : undefined
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <SectionCard
          title="Upcoming fixtures"
          description="Pre-match probabilities · home / draw / away"
        >
          {overview.upcoming.length === 0 ? (
            <EmptyState title="No fixtures in the next ten days" />
          ) : (
            <div className="space-y-2">
              {overview.live.map((match) => (
                <MatchRow key={match.id} match={match} />
              ))}
              {overview.upcoming.slice(0, 12).map((match) => (
                <MatchRow key={match.id} match={match} />
              ))}
            </div>
          )}
        </SectionCard>
        <div className="space-y-4">
          {overview.standings.map(({ competition, rows }) => (
            <SectionCard
              key={competition.key}
              title={competition.name}
              description={`${competition.season} · ${competition.region}`}
              contentClassName="px-0"
            >
              <StandingsTable rows={rows.slice(0, 8)} compact />
            </SectionCard>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Recent results vs model"
          description="Predictions made before kick-off, compared with the final score"
        >
          <div className="space-y-2">
            {overview.recent.slice(0, 8).map((match) => (
              <MatchRow key={match.id} match={match} compact />
            ))}
          </div>
        </SectionCard>
        <SectionCard
          title="Calibration"
          description="Pooled home/draw/away probabilities vs observed frequencies"
        >
          <CalibrationChart points={calibration} title="Football model calibration" />
        </SectionCard>
      </div>

      <Disclaimer>
        {siteConfig.sportsDisclaimer}{" "}
        {overview.provider.isSimulated
          ? "Clubs and competitions shown are fictional demo data."
          : `Fixtures and results: ${overview.provider.displayName}.`}
      </Disclaimer>
    </div>
  );
}
