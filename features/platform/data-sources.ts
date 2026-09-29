import "server-only";

import { getMarketDataProvider } from "@/lib/markets/providers";
import { getSportsDataProvider } from "@/lib/sports/providers";

/**
 * What kind of data each module is showing, for copy and labels. The demo providers simulate
 * everything; licensed providers serve ingested, delayed data. Resolving a provider does no I/O.
 */
export interface DataSourceSummary {
  simulated: boolean;
  /** Provider display name, e.g. "Polygon.io end-of-day". */
  name: string;
}

export interface DataSources {
  markets: DataSourceSummary;
  sports: DataSourceSummary;
}

export function getDataSources(): DataSources {
  const markets = getMarketDataProvider();
  const sports = getSportsDataProvider();
  return {
    markets: { simulated: markets.isSimulated, name: markets.displayName },
    sports: { simulated: sports.isSimulated, name: sports.displayName },
  };
}
