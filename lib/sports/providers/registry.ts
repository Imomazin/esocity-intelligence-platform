import type { SportsDataProviderId } from "@/lib/env";
import type { ProviderDescriptor } from "@/lib/markets/providers/registry";

/**
 * Sports data provider registry. `demo` (synthetic) and `api-football` (licensed, ingested into
 * PostgreSQL) are implemented; the others are documented placeholders (see
 * docs/SPORTS_ENGINE.md → "Adding a provider").
 */
export const SPORTS_DATA_PROVIDERS: ProviderDescriptor<SportsDataProviderId>[] = [
  {
    id: "demo",
    name: "Esocity synthetic football",
    status: "available",
    coverage: "2 fictional competitions, 22 clubs, rolling double round-robin season",
    envVars: [],
    notes:
      "Deterministic, key-free. Fictional clubs so synthetic output is never mistaken for real fixtures.",
  },
  {
    id: "sportmonks",
    name: "SportMonks",
    status: "planned",
    coverage: "Global football fixtures, results, lineups, injuries, xG",
    envVars: ["SPORTMONKS_API_TOKEN"],
    notes: "Map fixtures + sidelined players to MatchModelInputs; ingest on a schedule.",
  },
  {
    id: "api-football",
    name: "API-Football",
    status: "available",
    coverage:
      "Fixtures, 90-minute results, expected goals and availability for configured leagues, ingested into PostgreSQL",
    envVars: [
      "API_FOOTBALL_KEY",
      "API_FOOTBALL_LEAGUES",
      "API_FOOTBALL_MAX_REQUESTS_PER_RUN",
      "API_FOOTBALL_REQUESTS_PER_MINUTE",
      "DATABASE_URL",
      "CRON_SECRET",
    ],
    notes:
      "Daily ingestion (/api/cron/ingest/sports or `pnpm ingest sports`) within a per-run request budget; ratings are rebuilt walk-forward from stored results with last season as priors.",
  },
  {
    id: "opta",
    name: "Opta / Stats Perform",
    status: "planned",
    coverage: "Event-level data, advanced metrics, official xG",
    envVars: ["OPTA_FEED_ENDPOINT", "OPTA_FEED_CREDENTIALS"],
    notes: "Enterprise licence; requires contractual review of display and redistribution rights.",
  },
];
