import "server-only";

import type { MatchDetail, MatchSummary, SportsOverview } from "@/features/sports/types";
import { getNow } from "@/lib/clock";
import { getIntelligenceEngine } from "@/lib/ml/engine";
import { actualOutcome, evaluateSportsModel } from "@/lib/sports/evaluation";
import { predictMatch } from "@/lib/sports/football-model";
import { getSportsDataProvider } from "@/lib/sports/providers";
import type { Competition, Match, MatchPrediction } from "@/lib/sports/types";

function competitionRef(competitions: readonly Competition[], key: string) {
  const competition = competitions.find((candidate) => candidate.key === key);
  return {
    key,
    name: competition?.name ?? key,
    shortName: competition?.shortName ?? key.toUpperCase(),
  };
}

export function summariseMatch(
  match: Match,
  competitions: readonly Competition[],
  prediction: MatchPrediction = predictMatch(match.modelInputs),
): MatchSummary {
  const top = prediction.topScorelines[0] ?? null;
  return {
    id: match.id,
    competition: competitionRef(competitions, match.competitionKey),
    round: match.round,
    kickoffAt: match.kickoffAt,
    status: match.status,
    venue: match.venue,
    home: {
      key: match.homeTeam.key,
      name: match.homeTeam.name,
      shortName: match.homeTeam.shortName,
      code: match.homeTeam.code,
    },
    away: {
      key: match.awayTeam.key,
      name: match.awayTeam.name,
      shortName: match.awayTeam.shortName,
      code: match.awayTeam.code,
    },
    score: match.score,
    prediction: {
      home: prediction.outcome.home,
      draw: prediction.outcome.draw,
      away: prediction.outcome.away,
      lambdaHome: prediction.lambdaHome,
      lambdaAway: prediction.lambdaAway,
      over25: prediction.markets.over25,
      btts: prediction.markets.bttsYes,
      confidence: prediction.confidence,
      uncertainty: prediction.uncertainty,
      mostLikelyOutcome: prediction.mostLikelyOutcome,
      topScoreline: top,
    },
    outcomeCorrect: match.score
      ? actualOutcome(match.score.home, match.score.away) === prediction.mostLikelyOutcome
      : null,
  };
}

export async function getSportsOverview(
  options: { upcomingDays?: number } = {},
): Promise<SportsOverview> {
  const provider = getSportsDataProvider();
  const now = getNow();
  const horizon = new Date(now.getTime() + (options.upcomingDays ?? 10) * 86_400_000).toISOString();
  const [competitions, matches] = await Promise.all([
    provider.listCompetitions(),
    provider.listMatches(),
  ]);
  const finished = matches.filter((match) => match.status === "finished");
  const evaluation = evaluateSportsModel(finished);
  const { recent: evaluatedRecent, ...evaluationSummary } = evaluation;
  const standings = await Promise.all(
    competitions.map(async (competition) => ({
      competition,
      rows: await provider.getStandings(competition.key),
    })),
  );

  return {
    provider: {
      id: provider.id,
      displayName: provider.displayName,
      isSimulated: provider.isSimulated,
    },
    competitions,
    upcoming: matches
      .filter((match) => match.status === "scheduled" && match.kickoffAt <= horizon)
      .map((match) => summariseMatch(match, competitions)),
    live: matches
      .filter((match) => match.status === "live")
      .map((match) => summariseMatch(match, competitions)),
    recent: evaluatedRecent.map((entry) =>
      summariseMatch(entry.match, competitions, entry.prediction),
    ),
    standings,
    evaluation: evaluationSummary,
  };
}

export interface FixtureFilter {
  competition?: string;
  view?: "upcoming" | "results";
}

export async function getFootballFixtures(filter: FixtureFilter = {}): Promise<{
  competitions: Competition[];
  matches: MatchSummary[];
}> {
  const provider = getSportsDataProvider();
  const competitions = await provider.listCompetitions("football");
  const known = competitions.some((competition) => competition.key === filter.competition);
  const matches = await provider.listMatches({
    competitionKey: known ? filter.competition : undefined,
    status: filter.view === "results" ? ["finished"] : ["scheduled", "live"],
  });
  const ordered = filter.view === "results" ? [...matches].reverse() : matches;
  return {
    competitions,
    matches: ordered.slice(0, 60).map((match) => summariseMatch(match, competitions)),
  };
}

export async function getMatchDetail(id: string): Promise<MatchDetail | null> {
  const provider = getSportsDataProvider();
  const match = await provider.getMatch(id);
  if (!match) return null;
  const competitions = await provider.listCompetitions();
  const competition = competitions.find((candidate) => candidate.key === match.competitionKey);
  if (!competition) return null;

  const { prediction, engine } = await getIntelligenceEngine().predictMatch(match.modelInputs);
  const earlier = await provider.listMatches({
    competitionKey: match.competitionKey,
    status: ["finished"],
    teamKey: match.homeTeam.key,
  });
  const meeting = [...earlier]
    .reverse()
    .find(
      (candidate) =>
        candidate.id !== match.id &&
        candidate.kickoffAt < match.kickoffAt &&
        [candidate.homeTeam.key, candidate.awayTeam.key].includes(match.awayTeam.key),
    );

  return {
    match,
    competition,
    prediction,
    engine,
    context: match.context,
    previousMeeting: meeting ? summariseMatch(meeting, competitions) : null,
    outcomeCorrect: match.score
      ? actualOutcome(match.score.home, match.score.away) === prediction.mostLikelyOutcome
      : null,
  };
}
