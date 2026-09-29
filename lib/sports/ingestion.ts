import type { IngestionContext, IngestionWorkResult } from "@/lib/ingestion/runner";
import type { IngestionItem } from "@/lib/ingestion/types";
import { logger } from "@/lib/logger";
import { isProviderError, type ProviderError } from "@/lib/providers/errors";
import type {
  FixtureAvailability,
  LeagueSeason,
  UpstreamFixture,
  UpstreamTeam,
} from "@/lib/sports/providers/api-football";
import { MAX_IDS_PER_REQUEST } from "@/lib/sports/providers/api-football";
import type { MatchStatus } from "@/lib/sports/types";

/**
 * Football ingestion: licensed fixtures, results, expected goals and availability → PostgreSQL.
 *
 * Per configured league:
 *   1. Resolve the current (or pinned) season and what the provider covers for it.
 *   2. Upsert the competition season, its clubs and every fixture; only new or changed fixtures
 *      are written. Results are stored as 90-minute scores (the model predicts 90 minutes).
 *   3. Once, store the previous season's results — the ratings engine uses them as priors so
 *      the new season does not start from "every club is average".
 *   4. Within the remaining request budget: availability (injuries/suspensions) for fixtures in
 *      the next week, then expected goals for finished fixtures (20 per request).
 *
 * Nothing here computes probabilities: the stored provider rebuilds ratings walk-forward from
 * the stored results at read time, using only information available before each kick-off.
 */

export interface FootballSource {
  readonly id: string;
  readonly displayName: string;
  readonly requestCount: number;
  readonly remainingRequests: number;
  fetchLeagueSeason(leagueId: number, season?: number): Promise<LeagueSeason>;
  fetchTeams(leagueId: number, season: number): Promise<UpstreamTeam[]>;
  fetchFixtures(
    leagueId: number,
    season: number,
  ): Promise<{ fixtures: UpstreamFixture[]; skipped: number }>;
  fetchExpectedGoals(
    ids: readonly number[],
  ): Promise<Map<number, { home: number; away: number } | null>>;
  fetchAvailability(
    fixture: Pick<UpstreamFixture, "id" | "home" | "away">,
  ): Promise<FixtureAvailability>;
}

export interface CompetitionUpsert {
  key: string;
  name: string;
  region: string;
  season: string;
  baselineGoals: number;
  homeAdvantage: number;
  externalRef: string;
}

export interface TeamUpsert {
  key: string;
  competitionId: string;
  name: string;
  shortName: string;
  code: string;
  city: string | null;
  externalRef: string;
  metadata: Record<string, unknown>;
}

export interface FixtureUpsert {
  externalRef: string;
  homeTeamKey: string;
  awayTeamKey: string;
  kickoffAt: string;
  status: MatchStatus;
  matchday: number | null;
  venue: string | null;
  homeScore: number | null;
  awayScore: number | null;
  /** Merged into the stored context (xG and availability written separately are kept). */
  context: Record<string, unknown>;
}

export interface StoredFixtureState {
  externalRef: string;
  status: MatchStatus;
  kickoffAt: string;
  matchday: number | null;
  venue: string | null;
  homeScore: number | null;
  awayScore: number | null;
  xgChecked: boolean;
}

export interface SportsRepository {
  upsertCompetition(input: CompetitionUpsert): Promise<string>;
  findCompetition(
    key: string,
    season: string,
  ): Promise<{ id: string; fixtures: number; finished: number } | null>;
  /**
   * "replace" writes provider club records (codes, venues); "insert-missing" only adds clubs
   * known from fixtures alone, never overwriting richer records.
   */
  upsertTeams(teams: readonly TeamUpsert[], mode: "replace" | "insert-missing"): Promise<void>;
  readFixtureStates(competitionId: string): Promise<Map<string, StoredFixtureState>>;
  upsertFixtures(competitionId: string, fixtures: readonly FixtureUpsert[]): Promise<number>;
  mergeFixtureContext(externalRef: string, patch: Record<string, unknown>): Promise<void>;
}

export interface FootballIngestionOptions {
  source: FootballSource;
  /** Null for dry runs. */
  repository: SportsRepository | null;
  leagues: readonly number[];
  /** Pin a season (e.g. when a plan only covers past seasons); default: the current one. */
  season?: number;
  /** Availability is refreshed for fixtures kicking off within this many days. */
  availabilityWindowDays?: number;
  maxAvailabilityFixtures?: number;
}

/** Model priors used until a league's own history is ingested. */
export const DEFAULT_BASELINE_GOALS = 1.35;
export const DEFAULT_HOME_ADVANTAGE = 1.25;
const PROVIDER_KEY = "apif";

export const competitionKey = (leagueId: number) => `${PROVIDER_KEY}-l${leagueId}`;
export const teamKey = (teamId: number) => `${PROVIDER_KEY}-t${teamId}`;
export const matchRef = (fixtureId: number) => `${PROVIDER_KEY}-${fixtureId}`;
export const fixtureIdFromRef = (ref: string) => Number(ref.slice(PROVIDER_KEY.length + 1));

const AFFIXES =
  /^(?:A\.?F\.?C\.?|F\.?C\.?|C\.?F\.?|S\.?C\.?|1\.\s?FC)\s+|\s+(?:A\.?F\.?C\.?|F\.?C\.?|C\.?F\.?)$/gi;

/**
 * Compact but unambiguous display names: drop club-form affixes, keep names up to 16
 * characters, otherwise use the first word unless another club in the league shares it.
 */
export function deriveShortNames(names: readonly string[]): Map<string, string> {
  const cleaned = new Map(names.map((name) => [name, name.replace(AFFIXES, "").trim() || name]));
  const firstWords = new Map<string, number>();
  for (const value of cleaned.values()) {
    const first = value.split(/\s+/)[0] ?? value;
    firstWords.set(first, (firstWords.get(first) ?? 0) + 1);
  }
  const result = new Map<string, string>();
  for (const [name, value] of cleaned) {
    const first = value.split(/\s+/)[0] ?? value;
    const short = value.length <= 16 || (firstWords.get(first) ?? 0) > 1 ? value : first;
    result.set(name, short.slice(0, 40));
  }
  return result;
}

export function deriveCode(code: string | null, shortName: string): string {
  const provided = code?.trim().toUpperCase();
  if (provided && /^[A-Z0-9]{2,4}$/.test(provided)) return provided;
  const letters = shortName.toUpperCase().replace(/[^A-Z]/g, "");
  return (letters.slice(0, 3) || "TBD").padEnd(3, "X");
}

/** "2025/26" → "2024/25"; "2026" → "2025". */
export function previousSeasonLabel(league: Pick<LeagueSeason, "season" | "label">): string {
  const previous = league.season - 1;
  return league.label.includes("/")
    ? `${previous}/${String(league.season % 100).padStart(2, "0")}`
    : String(previous);
}

function sameFixture(stored: StoredFixtureState | undefined, fixture: UpstreamFixture): boolean {
  return (
    stored !== undefined &&
    stored.status === fixture.status &&
    stored.kickoffAt === fixture.kickoffAt &&
    stored.matchday === fixture.matchday &&
    stored.venue === (fixture.venue?.slice(0, 160) ?? null) &&
    stored.homeScore === (fixture.score?.home ?? null) &&
    stored.awayScore === (fixture.score?.away ?? null)
  );
}

function toUpsert(fixture: UpstreamFixture): FixtureUpsert {
  return {
    externalRef: matchRef(fixture.id),
    homeTeamKey: teamKey(fixture.home.id),
    awayTeamKey: teamKey(fixture.away.id),
    kickoffAt: fixture.kickoffAt,
    status: fixture.status,
    matchday: fixture.matchday,
    venue: fixture.venue,
    homeScore: fixture.score?.home ?? null,
    awayScore: fixture.score?.away ?? null,
    context: {
      provider: "api-football",
      providerStatus: fixture.providerStatus,
      round: fixture.round,
      referee: fixture.referee,
    },
  };
}

function isStop(error: unknown): error is ProviderError {
  return isProviderError(error) && error.kind === "budget_exhausted";
}

/**
 * Optional enrichment (availability, expected goals) must not fail a league whose fixtures are
 * already stored: provider errors become warnings. Authentication errors still abort the run.
 */
async function optionalStep(warnings: string[], label: string, step: () => Promise<void>) {
  try {
    await step();
  } catch (error) {
    if (!isProviderError(error) || error.kind === "auth") throw error;
    warnings.push(
      error.kind === "budget_exhausted"
        ? `${label} deferred (request budget) — the next run continues.`
        : `${label} incomplete (${error.message}) — the next run retries.`,
    );
  }
}

export async function ingestFootball(
  options: FootballIngestionOptions,
  context: IngestionContext,
): Promise<IngestionWorkResult> {
  const repository = context.dryRun ? null : options.repository;
  if (!context.dryRun && !repository) {
    throw new Error("A repository is required unless the run is a dry run.");
  }
  const { source } = options;
  const items: IngestionItem[] = [];
  const warnings: string[] = [];
  let stopReason: string | null = null;

  for (const leagueId of options.leagues) {
    const key = competitionKey(leagueId);
    if (!stopReason && context.outOfTime()) {
      stopReason = "Time budget exhausted — the next run continues.";
    }
    if (stopReason) {
      items.push({ key, status: "skipped", rowsWritten: 0, detail: stopReason });
      continue;
    }
    try {
      items.push(await ingestLeague(leagueId));
    } catch (error) {
      if (isProviderError(error) && error.kind === "auth") throw error;
      if (isStop(error)) {
        stopReason = "Provider request budget exhausted — the next run continues.";
        items.push({ key, status: "skipped", rowsWritten: 0, detail: stopReason });
        continue;
      }
      if (!isProviderError(error)) throw error;
      logger.warn("ingestion.sports.league_failed", { leagueId, error });
      items.push({ key, status: "failed", rowsWritten: 0, detail: error.message });
    }
  }
  if (options.leagues.length === 0)
    warnings.push("No leagues are configured (API_FOOTBALL_LEAGUES).");
  return { items, warnings, requestCount: source.requestCount };

  async function storeSeason(
    league: LeagueSeason,
    fixtures: readonly UpstreamFixture[],
    teams: readonly UpstreamTeam[],
    priors: { baselineGoals: number; homeAdvantage: number },
  ): Promise<{ competitionId: string; written: number; states: Map<string, StoredFixtureState> }> {
    const repo = repository as SportsRepository;
    const competitionId = await repo.upsertCompetition({
      key: competitionKey(league.leagueId),
      name: league.name,
      region: league.country,
      season: league.label,
      baselineGoals: priors.baselineGoals,
      homeAdvantage: priors.homeAdvantage,
      externalRef: `api-football:league:${league.leagueId}:${league.season}`,
    });

    // Clubs: provider team records where available, else names from the fixtures.
    const fromFixtures = new Map<number, UpstreamTeam>();
    for (const fixture of fixtures) {
      for (const side of [fixture.home, fixture.away]) {
        fromFixtures.set(side.id, {
          id: side.id,
          name: side.name,
          code: null,
          venue: null,
          city: null,
        });
      }
    }
    const records = new Map(teams.map((team) => [team.id, team]));
    const shortNames = deriveShortNames(
      [...new Map([...fromFixtures, ...records]).values()].map((team) => team.name),
    );
    const toRow = (team: UpstreamTeam): TeamUpsert => {
      const shortName = shortNames.get(team.name) ?? team.name;
      return {
        key: teamKey(team.id),
        competitionId,
        name: team.name.slice(0, 120),
        shortName,
        code: deriveCode(team.code, shortName),
        city: team.city,
        externalRef: `api-football:team:${team.id}`,
        metadata: { provider: "api-football", venue: team.venue },
      };
    };
    if (records.size > 0) await repo.upsertTeams([...records.values()].map(toRow), "replace");
    const missing = [...fromFixtures.values()].filter((team) => !records.has(team.id));
    if (missing.length > 0) await repo.upsertTeams(missing.map(toRow), "insert-missing");

    const states = await repo.readFixtureStates(competitionId);
    const changed = fixtures.filter(
      (fixture) => !sameFixture(states.get(matchRef(fixture.id)), fixture),
    );
    const written =
      changed.length > 0 ? await repo.upsertFixtures(competitionId, changed.map(toUpsert)) : 0;
    return { competitionId, written, states };
  }

  async function ingestLeague(leagueId: number): Promise<IngestionItem> {
    const itemWarnings: string[] = [];
    const league = await source.fetchLeagueSeason(leagueId, options.season);
    const key = competitionKey(leagueId);
    const label = `${league.name} ${league.label}`;
    const { fixtures, skipped } = await source.fetchFixtures(leagueId, league.season);
    if (skipped > 0) {
      itemWarnings.push(
        `${skipped} fixture(s) skipped (unknown status or a result without a score).`,
      );
    }
    const lastResult =
      fixtures
        .filter((fixture) => fixture.status === "finished")
        .map((fixture) => fixture.kickoffAt.slice(0, 10))
        .sort()
        .at(-1) ?? null;

    if (!repository) {
      const finished = fixtures.filter((fixture) => fixture.status === "finished").length;
      return {
        key,
        label,
        status: "unchanged",
        rowsWritten: 0,
        lastDataDate: lastResult,
        detail: `Dry run: ${fixtures.length} fixtures (${finished} results) would be stored.`,
        warnings: itemWarnings,
      };
    }

    const existing = await repository.findCompetition(key, league.label);
    // Club records (codes, venues) once per season; later runs only need the fixtures.
    const teams = existing ? [] : await source.fetchTeams(leagueId, league.season);
    let rowsWritten = 0;

    // Previous season's results as rating priors (fetched once).
    const previousSeason = league.season - 1;
    const previousLabel = previousSeasonLabel(league);
    const previous = await repository.findCompetition(key, previousLabel);
    if (!previous || previous.finished < previous.fixtures * 0.9) {
      // Optional: the season's own fixtures are already in hand and are stored regardless.
      if (source.remainingRequests <= 0) {
        itemWarnings.push("Previous season deferred (request budget) — the next run fetches it.");
      } else {
        try {
          const prior = await source.fetchFixtures(leagueId, previousSeason);
          const priorSeason: LeagueSeason = {
            ...league,
            season: previousSeason,
            label: previousLabel,
            start: null,
            end: null,
          };
          const stored = await storeSeason(priorSeason, prior.fixtures, [], {
            baselineGoals: DEFAULT_BASELINE_GOALS,
            homeAdvantage: DEFAULT_HOME_ADVANTAGE,
          });
          rowsWritten += stored.written;
        } catch (error) {
          if (!isProviderError(error) || error.kind === "rate_limited") throw error;
          itemWarnings.push(
            error.kind === "budget_exhausted"
              ? "Previous season deferred (request budget) — the next run fetches it."
              : `Previous season unavailable (${error.message}) — ratings start from neutral priors.`,
          );
        }
      }
    }

    const current = await storeSeason(league, fixtures, teams, {
      baselineGoals: DEFAULT_BASELINE_GOALS,
      homeAdvantage: DEFAULT_HOME_ADVANTAGE,
    });
    rowsWritten += current.written;

    // Availability for the coming week (refreshed every run), budget permitting.
    let availabilityChecked = 0;
    if (league.coverage.injuries) {
      const now = context.now().getTime();
      const horizon = now + (options.availabilityWindowDays ?? 7) * 86_400_000;
      const upcoming = fixtures
        .filter((fixture) => fixture.status === "scheduled")
        .filter((fixture) => {
          const kickoff = Date.parse(fixture.kickoffAt);
          return kickoff >= now && kickoff <= horizon;
        })
        .slice(0, options.maxAvailabilityFixtures ?? 12);
      await optionalStep(itemWarnings, "Availability", async () => {
        for (const fixture of upcoming) {
          // Keep one request in reserve for expected goals.
          if (source.remainingRequests <= 1 || context.outOfTime()) break;
          const availability = await source.fetchAvailability(fixture);
          await repository.mergeFixtureContext(matchRef(fixture.id), {
            availability: { ...availability, checkedAt: context.now().toISOString() },
          });
          availabilityChecked += 1;
        }
      });
      if (availabilityChecked < upcoming.length) {
        itemWarnings.push(
          `Availability refreshed for ${availabilityChecked} of ${upcoming.length} upcoming fixtures.`,
        );
      }
    }

    // Expected goals for finished fixtures not yet checked, 20 per request.
    let xgStored = 0;
    if (league.coverage.statistics) {
      const pending = fixtures
        .filter((fixture) => fixture.status === "finished")
        .filter((fixture) => !current.states.get(matchRef(fixture.id))?.xgChecked)
        .map((fixture) => fixture.id);
      let checked = 0;
      await optionalStep(itemWarnings, "Expected goals", async () => {
        for (let i = 0; i < pending.length; i += MAX_IDS_PER_REQUEST) {
          if (source.remainingRequests <= 0 || context.outOfTime()) break;
          const batch = pending.slice(i, i + MAX_IDS_PER_REQUEST);
          const xg = await source.fetchExpectedGoals(batch);
          for (const id of batch) {
            const value = xg.get(id) ?? null;
            await repository.mergeFixtureContext(matchRef(id), { xg: value, xgChecked: true });
            if (value) xgStored += 1;
          }
          checked += batch.length;
        }
      });
      if (checked < pending.length) {
        itemWarnings.push(
          `Expected goals pending for ${pending.length - checked} results — the next run continues.`,
        );
      }
    } else {
      itemWarnings.push(`${source.displayName} has no expected-goals coverage for ${label}.`);
    }

    const updated = rowsWritten > 0 || availabilityChecked > 0 || xgStored > 0;
    return {
      key,
      label,
      status: updated ? "updated" : "unchanged",
      rowsWritten,
      lastDataDate: lastResult,
      detail: `${fixtures.length} fixtures (${rowsWritten} new or changed), xG stored for ${xgStored}, availability for ${availabilityChecked}.`,
      warnings: itemWarnings,
    };
  }
}
