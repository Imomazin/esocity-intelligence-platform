import { addDays, getUsMarketSession, type TradingCalendar } from "@/lib/clock";
import type { IngestionContext, IngestionWorkResult } from "@/lib/ingestion/runner";
import type { IngestionItem } from "@/lib/ingestion/types";
import { logger } from "@/lib/logger";
import { changedBars, restatedDates, validateBars } from "@/lib/markets/bar-validation";
import { NYSE_CALENDAR } from "@/lib/markets/calendar";
import type { AssetProfile, PriceBar } from "@/lib/markets/types";
import { isProviderError } from "@/lib/providers/errors";

/**
 * Incremental daily-bar ingestion: licensed provider → validation → PostgreSQL.
 *
 * Per symbol:
 *   1. First run: backfill `backfillDays` of history through the last COMPLETED session.
 *   2. Later runs: re-fetch an overlap window before the last stored bar through the last
 *      completed session. Overlapping bars are compared with what is stored; if the provider
 *      has restated history (a split adjustment or a correction), the symbol's entire stored
 *      history is re-fetched and replaced atomically. Otherwise only new or changed bars are
 *      upserted.
 *   3. Every bar passes validateBars() first; nothing after the last completed session is ever
 *      stored, so the platform never sees a partially formed bar.
 *
 * Authentication failures abort the run (every symbol would fail). Other provider failures are
 * recorded per symbol and the run continues. Exhausting the time or request budget marks the
 * remaining symbols as skipped; the next run resumes from what is stored.
 */

export interface UpstreamAssetProfile extends AssetProfile {
  metadata: Record<string, unknown>;
}

/** Upstream history provider used by ingestion (never by page requests). */
export interface MarketHistorySource {
  /** Stable id; also the `market_prices.source` value of ingested bars. */
  readonly id: string;
  readonly displayName: string;
  readonly requestCount: number;
  fetchProfile(symbol: string): Promise<UpstreamAssetProfile | null>;
  /** Split-adjusted daily bars for [from, to] (YYYY-MM-DD, inclusive), any order. */
  fetchDailyBars(symbol: string, from: string, to: string): Promise<PriceBar[]>;
}

export interface StoredAsset {
  id: string;
  symbol: string;
}

export interface BarCoverage {
  first: string | null;
  last: string | null;
  count: number;
}

export interface MarketDataRepository {
  findAssets(symbols: readonly string[]): Promise<Map<string, StoredAsset>>;
  createAsset(profile: UpstreamAssetProfile): Promise<StoredAsset>;
  coverage(assetId: string, source: string): Promise<BarCoverage>;
  readBars(assetId: string, source: string, from: string, to: string): Promise<PriceBar[]>;
  upsertBars(assetId: string, source: string, bars: readonly PriceBar[]): Promise<number>;
  /** Atomically replace every stored bar of `source` for the asset. */
  replaceBars(assetId: string, source: string, bars: readonly PriceBar[]): Promise<number>;
}

export interface MarketIngestionOptions {
  source: MarketHistorySource;
  /** Null for dry runs. */
  repository: MarketDataRepository | null;
  symbols: readonly string[];
  /** Calendar days of history fetched for a symbol with nothing stored. */
  backfillDays: number;
  /** Calendar days re-fetched before the last stored bar to detect restatements. */
  overlapDays?: number;
  calendar?: TradingCalendar;
  /** Curated reference data (avoids a provider call and keeps editorial sector/descriptions). */
  curatedProfile?: (symbol: string) => AssetProfile | null;
}

export const DEFAULT_OVERLAP_DAYS = 14;

export async function ingestMarketHistory(
  options: MarketIngestionOptions,
  context: IngestionContext,
): Promise<IngestionWorkResult> {
  const calendar = options.calendar ?? NYSE_CALENDAR;
  const through = getUsMarketSession(context.now(), calendar).lastCompletedDate;
  const symbols = [...new Set(options.symbols.map((symbol) => symbol.trim().toUpperCase()))];
  const repository = context.dryRun ? null : options.repository;
  if (!context.dryRun && !repository) {
    throw new Error("A repository is required unless the run is a dry run.");
  }

  const stored = repository ? await repository.findAssets(symbols) : new Map<string, StoredAsset>();
  const items: IngestionItem[] = [];
  const warnings: string[] = [];
  let stopReason: string | null = null;

  for (const symbol of symbols) {
    if (!stopReason && context.outOfTime()) {
      stopReason = "Time budget exhausted — the next run continues from the stored data.";
    }
    if (stopReason) {
      items.push({ key: symbol, status: "skipped", rowsWritten: 0, detail: stopReason });
      continue;
    }
    try {
      items.push(await ingestSymbol(symbol, stored.get(symbol) ?? null));
    } catch (error) {
      if (isProviderError(error) && error.kind === "auth") throw error;
      if (isProviderError(error) && error.kind === "budget_exhausted") {
        stopReason = "Provider request budget exhausted — the next run continues.";
        items.push({ key: symbol, status: "skipped", rowsWritten: 0, detail: stopReason });
        continue;
      }
      if (!isProviderError(error)) throw error;
      logger.warn("ingestion.markets.symbol_failed", { symbol, error });
      items.push({ key: symbol, status: "failed", rowsWritten: 0, detail: error.message });
    }
  }

  if (symbols.length === 0) warnings.push("No symbols are configured (MARKET_DATA_SYMBOLS).");
  return { items, warnings, requestCount: options.source.requestCount };

  async function ingestSymbol(symbol: string, asset: StoredAsset | null): Promise<IngestionItem> {
    let assetId = asset?.id ?? null;
    let created = false;
    if (!assetId) {
      const curated = options.curatedProfile?.(symbol) ?? null;
      const profile: UpstreamAssetProfile | null = curated
        ? { ...curated, metadata: { referenceData: "curated" } }
        : await options.source.fetchProfile(symbol);
      if (!profile) {
        return {
          key: symbol,
          status: "failed",
          rowsWritten: 0,
          detail: `${options.source.displayName} has no USD-listed instrument "${symbol}".`,
        };
      }
      if (repository) {
        assetId = (await repository.createAsset({ ...profile, symbol })).id;
        created = true;
      }
    }

    const coverage =
      repository && assetId
        ? await repository.coverage(assetId, options.source.id)
        : { first: null, last: null, count: 0 };

    // ── First ingestion: backfill ────────────────────────────────────────────────────────
    if (!coverage.last || !coverage.first) {
      const from = addDays(through, -options.backfillDays);
      const validated = validateBars(await options.source.fetchDailyBars(symbol, from, through), {
        through,
        calendar,
      });
      if (validated.bars.length === 0) {
        return {
          key: symbol,
          status: "failed",
          rowsWritten: 0,
          detail: `No valid daily bars returned for ${from} → ${through}.`,
          warnings: validated.warnings,
        };
      }
      const written =
        repository && assetId
          ? await repository.upsertBars(assetId, options.source.id, validated.bars)
          : 0;
      return {
        key: symbol,
        status: "updated",
        rowsWritten: written,
        lastDataDate: validated.bars[validated.bars.length - 1]?.date ?? null,
        detail: context.dryRun
          ? `Dry run: ${validated.bars.length} bars would be stored (${validated.bars[0]?.date} → ${through}).`
          : `Backfilled ${written} bars${created ? " (new asset)" : ""}.`,
        warnings: validated.warnings,
      };
    }

    // ── Incremental update with restatement detection ────────────────────────────────────
    const repo = repository as MarketDataRepository;
    const id = assetId as string;
    const overlapFrom = addDays(coverage.last, -(options.overlapDays ?? DEFAULT_OVERLAP_DAYS));
    const from = overlapFrom > coverage.first ? overlapFrom : coverage.first;
    const validated = validateBars(await options.source.fetchDailyBars(symbol, from, through), {
      through,
      calendar,
    });
    const storedWindow = await repo.readBars(id, options.source.id, from, coverage.last);
    const restated = restatedDates(storedWindow, validated.bars);

    if (restated.length > 0) {
      // Re-fetch everything we hold for this symbol and swap it in one transaction.
      const full = validateBars(
        await options.source.fetchDailyBars(symbol, coverage.first, through),
        { through, calendar },
      );
      if (full.bars.length === 0) {
        return {
          key: symbol,
          status: "failed",
          rowsWritten: 0,
          detail: "History was restated upstream but the re-fetch returned no valid bars.",
          warnings: full.warnings,
        };
      }
      const written = await repo.replaceBars(id, options.source.id, full.bars);
      return {
        key: symbol,
        status: "restated",
        rowsWritten: written,
        lastDataDate: full.bars[full.bars.length - 1]?.date ?? null,
        detail: `Upstream history changed from ${restated[0]} (e.g. a split adjustment); ${written} bars re-ingested.`,
        warnings: full.warnings,
      };
    }

    const changes = changedBars(storedWindow, validated.bars);
    const written = changes.length > 0 ? await repo.upsertBars(id, options.source.id, changes) : 0;
    const lastDataDate = [coverage.last, validated.bars[validated.bars.length - 1]?.date ?? ""]
      .sort()
      .at(-1);
    return {
      key: symbol,
      status: written > 0 ? "updated" : "unchanged",
      rowsWritten: written,
      lastDataDate: lastDataDate || null,
      detail:
        written > 0
          ? `${written} new or revised bars through ${lastDataDate}.`
          : `Up to date through ${lastDataDate}.`,
      warnings: validated.warnings,
    };
  }
}
