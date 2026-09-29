import { z } from "zod";

import { newYorkDate } from "@/lib/clock";
import type { MarketHistorySource, UpstreamAssetProfile } from "@/lib/markets/ingestion";
import type { PriceBar } from "@/lib/markets/types";
import { ProviderError } from "@/lib/providers/errors";
import { ProviderHttpClient, type ProviderHttpClientOptions } from "@/lib/providers/http";

/**
 * Polygon.io (now also served as Massive) REST adapter — used by ingestion only; pages read the
 * ingested bars from PostgreSQL (StoredMarketDataProvider).
 *
 *   Daily bars     GET /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}?adjusted=true&sort=asc
 *   Reference data GET /v3/reference/tickers/{ticker}
 *
 * Bars are split-adjusted (`adjusted=true`); dividends are not adjusted. Daily aggregates are
 * stamped at 00:00 America/New_York of the trading date, so dates are read in New York time.
 * The API key is sent as a bearer token, never as a query parameter.
 */

export const POLYGON_DEFAULT_BASE_URL = "https://api.polygon.io";
const MAX_PAGES = 20;

const aggregateSchema = z.looseObject({
  t: z.number(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
});

const aggregatesResponseSchema = z.looseObject({
  status: z.string(),
  results: z.array(aggregateSchema).optional(),
  next_url: z.string().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

const tickerDetailsSchema = z.looseObject({
  status: z.string().optional(),
  results: z.looseObject({
    ticker: z.string(),
    name: z.string(),
    market: z.string().optional(),
    type: z.string().optional(),
    active: z.boolean().optional(),
    primary_exchange: z.string().optional(),
    currency_name: z.string().optional(),
    description: z.string().optional(),
    sic_code: z.string().optional(),
    sic_description: z.string().optional(),
    list_date: z.string().optional(),
    cik: z.string().optional(),
  }),
});

type TickerDetails = z.output<typeof tickerDetailsSchema>["results"];

const OK_STATUSES = new Set(["OK", "DELAYED"]);
const FUND_TYPES = new Set(["ETF", "ETN", "ETV", "ETS", "FUND"]);

/** Market Identifier Codes → familiar exchange names. */
const EXCHANGE_NAMES: Record<string, string> = {
  XNAS: "NASDAQ",
  XNYS: "NYSE",
  ARCX: "NYSE Arca",
  XASE: "NYSE American",
  BATS: "Cboe BZX",
  XCHI: "NYSE Chicago",
  IEXG: "IEX",
};

/** SIC division from a four-digit Standard Industrial Classification code. */
const SIC_DIVISIONS: readonly [number, number, string][] = [
  [100, 999, "Agriculture, Forestry & Fishing"],
  [1000, 1499, "Mining"],
  [1500, 1799, "Construction"],
  [2000, 3999, "Manufacturing"],
  [4000, 4999, "Transportation, Communications & Utilities"],
  [5000, 5199, "Wholesale Trade"],
  [5200, 5999, "Retail Trade"],
  [6000, 6799, "Finance, Insurance & Real Estate"],
  [7000, 8999, "Services"],
  [9100, 9729, "Public Administration"],
];

export function sicDivision(code: string | undefined): string | null {
  if (!code || !/^\d{3,4}$/.test(code)) return null;
  const value = Number(code);
  return SIC_DIVISIONS.find(([low, high]) => value >= low && value <= high)?.[2] ?? null;
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[\s\-/&(])([a-z])/g, (_, lead: string, letter: string) => {
    return `${lead}${letter.toUpperCase()}`;
  });
}

export function mapPolygonProfile(details: TickerDetails): UpstreamAssetProfile | null {
  if (details.currency_name && details.currency_name.toUpperCase() !== "USD") return null;
  const type = details.type?.toUpperCase() ?? "";
  const isFund = FUND_TYPES.has(type);
  const exchange = details.primary_exchange
    ? (EXCHANGE_NAMES[details.primary_exchange] ?? details.primary_exchange)
    : "US";
  return {
    symbol: details.ticker.toUpperCase(),
    name: details.name,
    assetClass: isFund ? "etf" : "equity",
    exchange,
    sector: isFund ? "Exchange-traded fund" : (sicDivision(details.sic_code) ?? "Unclassified"),
    industry: details.sic_description
      ? titleCase(details.sic_description)
      : isFund
        ? "Fund"
        : "Unclassified",
    currency: "USD",
    description: details.description?.trim() || `${details.name} (${details.ticker}).`,
    metadata: {
      provider: "polygon",
      polygonType: details.type ?? null,
      primaryExchange: details.primary_exchange ?? null,
      sicCode: details.sic_code ?? null,
      listDate: details.list_date ?? null,
      cik: details.cik ?? null,
    },
  };
}

export interface PolygonSourceOptions {
  apiKey: string;
  baseUrl?: string;
  /** Plan quota; the free tier allows five requests per minute. */
  requestsPerMinute?: number;
  http?: Partial<ProviderHttpClientOptions>;
}

export class PolygonHistorySource implements MarketHistorySource {
  readonly id = "polygon";
  readonly displayName = "Polygon.io";
  private readonly client: ProviderHttpClient;

  constructor(options: PolygonSourceOptions) {
    const perMinute = options.requestsPerMinute ?? 5;
    this.client = new ProviderHttpClient({
      providerId: this.id,
      baseUrl: options.baseUrl ?? POLYGON_DEFAULT_BASE_URL,
      headers: { authorization: `Bearer ${options.apiKey}` },
      // Spread requests evenly across the minute, with a little headroom.
      minIntervalMs: perMinute > 0 ? Math.ceil(60_000 / perMinute) + 250 : 0,
      maxBackoffMs: 65_000,
      ...options.http,
    });
  }

  get requestCount(): number {
    return this.client.requestCount;
  }

  async fetchProfile(symbol: string): Promise<UpstreamAssetProfile | null> {
    try {
      const response = await this.client.getJson(
        `/v3/reference/tickers/${encodeURIComponent(symbol)}`,
        tickerDetailsSchema,
      );
      return mapPolygonProfile(response.results);
    } catch (error) {
      if (error instanceof ProviderError && error.kind === "not_found") return null;
      throw error;
    }
  }

  async fetchDailyBars(symbol: string, from: string, to: string): Promise<PriceBar[]> {
    const bars: PriceBar[] = [];
    let next: string | undefined =
      `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${from}/${to}`;
    let query: Record<string, string | number | boolean> = {
      adjusted: true,
      sort: "asc",
      limit: 50_000,
    };
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const response: z.output<typeof aggregatesResponseSchema> = await this.client.getJson(
        next,
        aggregatesResponseSchema,
        query,
      );
      if (!OK_STATUSES.has(response.status)) {
        throw new ProviderError(
          this.id,
          `aggregates for ${symbol} returned status ${response.status}${
            (response.error ?? response.message) ? ` — ${response.error ?? response.message}` : ""
          }`,
          { kind: "invalid_response" },
        );
      }
      for (const aggregate of response.results ?? []) {
        bars.push({
          date: newYorkDate(new Date(aggregate.t)),
          open: aggregate.o,
          high: aggregate.h,
          low: aggregate.l,
          close: aggregate.c,
          volume: aggregate.v,
        });
      }
      next = response.next_url;
      query = {}; // next_url already carries the cursor and parameters
    }
    return bars;
  }
}
