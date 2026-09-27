import type { SportsDataProviderId } from "@/lib/env";
import type { ProviderDescriptor } from "@/lib/markets/providers/registry";

/**
 * Sports data provider registry. Only `demo` ships in Phase 1; the others are documented
 * placeholders (see docs/SPORTS_ENGINE.md → "Adding a provider").
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
    status: "planned",
    coverage: "Fixtures, standings, injuries, statistics for 1,000+ competitions",
    envVars: ["API_FOOTBALL_KEY"],
    notes: "Rate-limited per day — cache aggressively in Redis and persist to PostgreSQL.",
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
