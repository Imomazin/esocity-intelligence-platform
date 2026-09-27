import { ArrowLeft, Check, MapPin, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ScoreMatrix } from "@/components/charts/score-matrix";
import { DataSourceNote, Disclaimer } from "@/components/data/disclaimer";
import { KeyValueList } from "@/components/data/key-value-list";
import { SectionCard } from "@/components/data/section-card";
import { RiskBadge } from "@/components/indicators/badges";
import { ProbabilityMeter } from "@/components/indicators/meters";
import { OutcomeBar } from "@/components/indicators/outcome-bar";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  GoalsMarkets,
  LambdaDerivation,
  TeamComparison,
  TopScorelines,
} from "@/features/sports/components/match-analysis";
import { MatchRow } from "@/features/sports/components/match-row";
import { getMatchDetail } from "@/features/sports/queries";
import { formatDateTimeUtc, formatPercent } from "@/lib/format";
import { siteConfig } from "@/lib/site";

export const revalidate = 300;

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const detail = await getMatchDetail(id);
  return {
    title: detail ? `${detail.match.homeTeam.name} v ${detail.match.awayTeam.name}` : "Match",
    description: "Poisson / Dixon–Coles match probabilities (fictional demo fixture).",
  };
}

const STATUS_LABEL = {
  scheduled: "Scheduled",
  live: "In play",
  finished: "Full time",
  postponed: "Postponed",
  cancelled: "Cancelled",
} as const;

export default async function MatchPage({ params }: Params) {
  const { id } = await params;
  const detail = await getMatchDetail(id);
  if (!detail) notFound();
  const { match, prediction, competition, context, engine } = detail;
  const home = match.homeTeam;
  const away = match.awayTeam;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
        <Link href="/sports/football">
          <ArrowLeft /> Fixtures
        </Link>
      </Button>

      <PageHeader
        eyebrow={`${competition.name} · Round ${match.round} · ${STATUS_LABEL[match.status]}`}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{home.name}</span>
            {match.score ? (
              <span className="num rounded-md bg-muted px-2.5 py-0.5">
                {match.score.home}–{match.score.away}
              </span>
            ) : (
              <span className="text-muted-foreground">v</span>
            )}
            <span>{away.name}</span>
          </span>
        }
        meta={
          <>
            <span>{formatDateTimeUtc(match.kickoffAt)}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" aria-hidden /> {match.venue}
            </span>
            <span aria-hidden>·</span>
            <DataSourceNote
              simulated
              source={engine.source === "remote" ? engine.name : "Esocity football model"}
            />
          </>
        }
        actions={<RiskBadge level={prediction.uncertainty} suffix="uncertainty" />}
      />

      {engine.fallbackReason && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          The ML service was unavailable ({engine.fallbackReason}); this prediction was computed by
          the built-in engine.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <SectionCard title="Outcome probabilities" description="Home win · draw · away win">
          <div className="space-y-5">
            <OutcomeBar
              home={prediction.outcome.home}
              draw={prediction.outcome.draw}
              away={prediction.outcome.away}
              homeLabel={home.shortName}
              awayLabel={away.shortName}
            />
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: `${home.shortName} win`, value: prediction.outcome.home, key: "HOME" },
                { label: "Draw", value: prediction.outcome.draw, key: "DRAW" },
                { label: `${away.shortName} win`, value: prediction.outcome.away, key: "AWAY" },
              ].map((entry) => (
                <div key={entry.key} className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{entry.label}</p>
                  <p className="text-2xl font-semibold">{formatPercent(entry.value, 1)}</p>
                  {prediction.mostLikelyOutcome === entry.key && (
                    <p className="mt-1 text-[11px] font-medium text-primary">Most likely</p>
                  )}
                </div>
              ))}
            </div>
            {match.score && detail.outcomeCorrect !== null && (
              <p className="inline-flex items-center gap-1.5 text-sm">
                {detail.outcomeCorrect ? (
                  <Check className="size-4 text-positive" aria-hidden />
                ) : (
                  <X className="size-4 text-negative" aria-hidden />
                )}
                {detail.outcomeCorrect
                  ? "The model's most likely outcome occurred."
                  : "The result differed from the model's most likely outcome — as a probabilistic forecast, this is expected some of the time."}
              </p>
            )}
          </div>
        </SectionCard>
        <SectionCard title="Model confidence" description={`Model v${prediction.modelVersion}`}>
          <div className="space-y-4">
            <ProbabilityMeter label="Confidence" value={prediction.confidence} emphasis />
            <KeyValueList
              items={[
                {
                  label: "Expected goals",
                  value: `${prediction.lambdaHome.toFixed(2)} – ${prediction.lambdaAway.toFixed(2)}`,
                },
                {
                  label: "Outcome entropy",
                  value: prediction.outcomeEntropy.toFixed(3),
                  hint: "1.000 = coin-flip",
                },
                { label: "Input completeness", value: formatPercent(prediction.dataQuality, 0) },
                { label: "Dixon–Coles ρ", value: prediction.rho.toFixed(3) },
                {
                  label: "Truncated tail mass",
                  value: `${(prediction.truncatedMass * 100).toFixed(2)}%`,
                  hint: "renormalised",
                },
              ]}
            />
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Correct-score probabilities"
          description="0–6 goals per side, renormalised to sum to 100%"
        >
          <ScoreMatrix
            matrix={prediction.scoreMatrix}
            homeLabel={home.shortName}
            awayLabel={away.shortName}
          />
        </SectionCard>
        <div className="space-y-4">
          <SectionCard title="Most likely scorelines">
            <TopScorelines prediction={prediction} homeCode={home.code} awayCode={away.code} />
          </SectionCard>
          <SectionCard title="Goals markets">
            <GoalsMarkets
              markets={prediction.markets}
              homeName={home.shortName}
              awayName={away.shortName}
            />
          </SectionCard>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Team comparison"
          description="Pre-match inputs (earlier results only)"
          contentClassName="px-0"
        >
          <TeamComparison match={match} context={context} />
        </SectionCard>
        <SectionCard
          title="How expected goals are derived"
          description="λ = product of the multipliers below"
          contentClassName="px-0"
        >
          <LambdaDerivation factors={prediction.factors} prediction={prediction} />
        </SectionCard>
      </div>

      {detail.previousMeeting && (
        <SectionCard title="Earlier meeting this season">
          <MatchRow match={detail.previousMeeting} compact />
        </SectionCard>
      )}

      <Disclaimer>
        {siteConfig.sportsDisclaimer} {home.name} and {away.name} are fictional demo clubs.
      </Disclaimer>
    </div>
  );
}
