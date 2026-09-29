import { getDb } from "@/db/client";
import { readFootballSnapshot } from "@/db/repositories/sports-data";
import { ConfigurationError } from "@/lib/api/errors";
import { getServerEnv } from "@/lib/env";
import { renderAtRequestTime } from "@/lib/request-time";
import { competitionKey } from "@/lib/sports/ingestion";
import { DemoSportsDataProvider } from "@/lib/sports/providers/demo-provider";
import { SPORTS_DATA_PROVIDERS } from "@/lib/sports/providers/registry";
import { StoredSportsDataProvider } from "@/lib/sports/providers/stored-provider";
import type { SportsDataProvider } from "@/lib/sports/providers/types";

export type { MatchFilter, SportsDataProvider } from "@/lib/sports/providers/types";

let provider: SportsDataProvider | null = null;

/** Resolve the configured sports data provider (SPORTS_DATA_PROVIDER, default "demo"). */
export function getSportsDataProvider(): SportsDataProvider {
  if (provider) return provider;
  const env = getServerEnv();
  const id = env.SPORTS_DATA_PROVIDER;
  switch (id) {
    case "demo":
      provider = new DemoSportsDataProvider();
      return provider;
    case "api-football": {
      if (!env.DATABASE_URL) {
        throw new ConfigurationError(
          "SPORTS_DATA_PROVIDER=api-football requires DATABASE_URL: ingested fixtures are served from PostgreSQL.",
        );
      }
      const keys = env.API_FOOTBALL_LEAGUES.map(competitionKey);
      provider = new StoredSportsDataProvider({
        id: "api-football",
        displayName: "API-Football",
        competitionKeys: keys,
        beforeRead: renderAtRequestTime,
        load: () => readFootballSnapshot(getDb(), keys),
      });
      return provider;
    }
    default: {
      const descriptor = SPORTS_DATA_PROVIDERS.find((entry) => entry.id === id);
      throw new ConfigurationError(
        `Sports data provider "${descriptor?.name ?? id}" is planned but not implemented yet. ` +
          `Set SPORTS_DATA_PROVIDER=demo or implement SportsDataProvider (docs/SPORTS_ENGINE.md).`,
      );
    }
  }
}

/** Test helper. */
export function setSportsDataProviderForTesting(next: SportsDataProvider | null): void {
  provider = next;
}
