import { and, asc, between, eq, gte, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { assets, marketPrices } from "@/db/schema";
import type {
  BarCoverage,
  MarketDataRepository,
  StoredAsset,
  UpstreamAssetProfile,
} from "@/lib/markets/ingestion";
import type { AssetProfile, PriceBar } from "@/lib/markets/types";

/**
 * PostgreSQL access for ingested market data. Daily bars are stored with `ts` = 00:00 UTC of
 * the trading date, `interval` = '1d' and `source` = the provider id, so demo-seeded bars
 * (source 'demo') and licensed bars never mix when read back.
 */

const BATCH_SIZE = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

const barDate = (ts: Date) => ts.toISOString().slice(0, 10);
const dateTs = (date: string) => new Date(`${date}T00:00:00Z`);

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function writeBars(
  executor: Database | Transaction,
  assetId: string,
  source: string,
  bars: readonly PriceBar[],
): Promise<number> {
  let written = 0;
  for (const batch of chunk(bars, BATCH_SIZE)) {
    const rows = await executor
      .insert(marketPrices)
      .values(
        batch.map((bar) => ({
          assetId,
          interval: "1d" as const,
          ts: dateTs(bar.date),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
          source,
        })),
      )
      .onConflictDoUpdate({
        target: [marketPrices.assetId, marketPrices.interval, marketPrices.ts],
        set: {
          open: sql`excluded.open`,
          high: sql`excluded.high`,
          low: sql`excluded.low`,
          close: sql`excluded.close`,
          volume: sql`excluded.volume`,
          source: sql`excluded.source`,
        },
      })
      .returning({ id: marketPrices.id });
    written += rows.length;
  }
  return written;
}

export class PostgresMarketDataRepository implements MarketDataRepository {
  constructor(private readonly db: Database) {}

  async findAssets(symbols: readonly string[]): Promise<Map<string, StoredAsset>> {
    if (symbols.length === 0) return new Map();
    const rows = await this.db
      .select({ id: assets.id, symbol: assets.symbol })
      .from(assets)
      .where(inArray(assets.symbol, [...symbols]));
    return new Map(rows.map((row) => [row.symbol, row]));
  }

  async createAsset(profile: UpstreamAssetProfile): Promise<StoredAsset> {
    const [row] = await this.db
      .insert(assets)
      .values({
        symbol: profile.symbol,
        name: profile.name.slice(0, 160),
        assetClass: profile.assetClass,
        exchange: profile.exchange.slice(0, 32),
        currency: profile.currency,
        sector: profile.sector.slice(0, 80),
        industry: profile.industry.slice(0, 120),
        description: profile.description,
        metadata: profile.metadata,
      })
      // A concurrent writer (or the demo seed) may have created it: keep that row.
      .onConflictDoUpdate({ target: assets.symbol, set: { updatedAt: new Date() } })
      .returning({ id: assets.id, symbol: assets.symbol });
    if (!row) throw new Error(`Failed to create asset ${profile.symbol}`);
    return row;
  }

  async coverage(assetId: string, source: string): Promise<BarCoverage> {
    const [row] = await this.db
      .select({
        first: sql<
          string | null
        >`to_char(min(${marketPrices.ts}) at time zone 'UTC', 'YYYY-MM-DD')`,
        last: sql<string | null>`to_char(max(${marketPrices.ts}) at time zone 'UTC', 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(marketPrices)
      .where(
        and(
          eq(marketPrices.assetId, assetId),
          eq(marketPrices.source, source),
          eq(marketPrices.interval, "1d"),
        ),
      );
    return { first: row?.first ?? null, last: row?.last ?? null, count: row?.count ?? 0 };
  }

  async readBars(assetId: string, source: string, from: string, to: string): Promise<PriceBar[]> {
    const rows = await this.db
      .select({
        ts: marketPrices.ts,
        open: marketPrices.open,
        high: marketPrices.high,
        low: marketPrices.low,
        close: marketPrices.close,
        volume: marketPrices.volume,
      })
      .from(marketPrices)
      .where(
        and(
          eq(marketPrices.assetId, assetId),
          eq(marketPrices.source, source),
          eq(marketPrices.interval, "1d"),
          between(marketPrices.ts, dateTs(from), dateTs(to)),
        ),
      )
      .orderBy(asc(marketPrices.ts));
    return rows.map(({ ts, ...bar }) => ({ date: barDate(ts), ...bar }));
  }

  async upsertBars(assetId: string, source: string, bars: readonly PriceBar[]): Promise<number> {
    return writeBars(this.db, assetId, source, bars);
  }

  async replaceBars(assetId: string, source: string, bars: readonly PriceBar[]): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(marketPrices)
        .where(
          and(
            eq(marketPrices.assetId, assetId),
            eq(marketPrices.source, source),
            eq(marketPrices.interval, "1d"),
          ),
        );
      return writeBars(tx, assetId, source, bars);
    });
  }
}

export interface MarketSnapshotRows {
  profiles: AssetProfile[];
  bars: Map<string, PriceBar[]>;
}

/** Profiles and daily bars of `source` for a universe, oldest first (one round trip each). */
export async function readMarketSnapshot(
  db: Database,
  source: string,
  symbols: readonly string[],
  since: string,
): Promise<MarketSnapshotRows> {
  if (symbols.length === 0) return { profiles: [], bars: new Map() };
  const [assetRows, priceRows] = await Promise.all([
    db
      .select()
      .from(assets)
      .where(and(inArray(assets.symbol, [...symbols]), eq(assets.isActive, true))),
    db
      .select({
        symbol: assets.symbol,
        ts: marketPrices.ts,
        open: marketPrices.open,
        high: marketPrices.high,
        low: marketPrices.low,
        close: marketPrices.close,
        volume: marketPrices.volume,
      })
      .from(marketPrices)
      .innerJoin(assets, eq(assets.id, marketPrices.assetId))
      .where(
        and(
          eq(marketPrices.source, source),
          eq(marketPrices.interval, "1d"),
          inArray(assets.symbol, [...symbols]),
          gte(marketPrices.ts, dateTs(since)),
        ),
      )
      .orderBy(asc(assets.symbol), asc(marketPrices.ts)),
  ]);

  const bars = new Map<string, PriceBar[]>();
  for (const { symbol, ts, ...bar } of priceRows) {
    const list = bars.get(symbol) ?? [];
    list.push({ date: barDate(ts), ...bar });
    bars.set(symbol, list);
  }
  const profiles: AssetProfile[] = assetRows.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    assetClass: row.assetClass === "etf" ? "etf" : "equity",
    exchange: row.exchange ?? "US",
    sector: row.sector ?? "Unclassified",
    industry: row.industry ?? "Unclassified",
    currency: "USD",
    description: row.description ?? row.name,
  }));
  return { profiles, bars };
}

export interface SymbolCoverage {
  symbol: string;
  first: string | null;
  last: string | null;
  bars: number;
}

/** Stored coverage per symbol for freshness monitoring. */
export async function readMarketCoverage(
  db: Database,
  source: string,
  symbols: readonly string[],
): Promise<SymbolCoverage[]> {
  if (symbols.length === 0) return [];
  const rows = await db
    .select({
      symbol: assets.symbol,
      first: sql<string | null>`to_char(min(${marketPrices.ts}) at time zone 'UTC', 'YYYY-MM-DD')`,
      last: sql<string | null>`to_char(max(${marketPrices.ts}) at time zone 'UTC', 'YYYY-MM-DD')`,
      bars: sql<number>`count(${marketPrices.id})::int`,
    })
    .from(assets)
    .leftJoin(
      marketPrices,
      and(
        eq(marketPrices.assetId, assets.id),
        eq(marketPrices.source, source),
        eq(marketPrices.interval, "1d"),
      ),
    )
    .where(inArray(assets.symbol, [...symbols]))
    .groupBy(assets.symbol);
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  return symbols.map(
    (symbol) => bySymbol.get(symbol) ?? { symbol, first: null, last: null, bars: 0 },
  );
}
