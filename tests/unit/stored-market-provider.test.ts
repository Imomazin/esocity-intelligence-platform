import { describe, expect, it, vi } from "vitest";

import { DataUnavailableError } from "@/lib/api/errors";
import { addDays, tradingDaysBetween } from "@/lib/clock";
import { analyzeUniverse } from "@/lib/markets/analysis";
import { NYSE_CALENDAR } from "@/lib/markets/calendar";
import {
  MIN_ANALYSIS_BARS,
  StoredMarketDataProvider,
  type StoredMarketRows,
} from "@/lib/markets/providers/stored-provider";
import type { AssetProfile, PriceBar } from "@/lib/markets/types";
import { fakeBar } from "@/tests/helpers/market-fakes";

const profile = (symbol: string): AssetProfile => ({
  symbol,
  name: `${symbol} Inc.`,
  assetClass: "equity",
  exchange: "NASDAQ",
  sector: "Services",
  industry: "Software",
  currency: "USD",
  description: `${symbol} test.`,
});

function history(symbol: string, through: string, sessions: number): PriceBar[] {
  const dates = tradingDaysBetween(NYSE_CALENDAR, addDays(through, -sessions * 2), through);
  return dates.slice(-sessions).map((date) => fakeBar(symbol, date));
}

function rows(entries: [string, PriceBar[]][]): StoredMarketRows {
  return {
    profiles: entries.map(([symbol]) => profile(symbol)),
    bars: new Map(entries),
  };
}

// Friday 27 November 2026 (day after Thanksgiving, 13:00 early close), 15:00 New York.
const AFTER_EARLY_CLOSE = new Date("2026-11-27T20:00:00Z");

function provider(load: () => Promise<StoredMarketRows>, clock = AFTER_EARLY_CLOSE) {
  return new StoredMarketDataProvider({
    id: "polygon",
    displayName: "Polygon.io end-of-day",
    symbols: ["MSFT", "AAPL", "NEWCO"],
    load,
    clock: () => clock,
  });
}

describe("StoredMarketDataProvider", () => {
  it("serves the configured universe in order and withholds short histories", async () => {
    const store = provider(async () =>
      rows([
        ["AAPL", history("AAPL", "2026-11-27", 300)],
        ["MSFT", history("MSFT", "2026-11-27", 300)],
        ["NEWCO", history("NEWCO", "2026-11-27", MIN_ANALYSIS_BARS - 1)],
      ]),
    );
    expect((await store.listAssets()).map((asset) => asset.symbol)).toEqual(["MSFT", "AAPL"]);
    expect(await store.getAsset("newco")).toBeNull();
    expect((await store.snapshot()).withheld).toEqual([
      { symbol: "NEWCO", bars: MIN_ANALYSIS_BARS - 1 },
    ]);
    expect(store.isSimulated).toBe(false);
  });

  it("explains that nothing has been ingested yet", async () => {
    const store = provider(async () => rows([]));
    await expect(store.listAssets()).rejects.toBeInstanceOf(DataUnavailableError);
    await expect(store.listAssets()).rejects.toThrow(/pnpm ingest markets/);
  });

  it("never serves bars after the last completed session", async () => {
    const bars = history("AAPL", "2026-11-27", 200);
    bars.push(fakeBar("AAPL", "2026-11-30"));
    const store = provider(async () => rows([["AAPL", bars]]));
    const served = await store.getDailyBars("AAPL");
    expect(served.at(-1)?.date).toBe("2026-11-27");
    expect(await store.getDailyBars("AAPL", { from: "2026-11-20", limit: 2 })).toHaveLength(2);
  });

  it("quotes the last close as delayed data at the (early) session close", async () => {
    const bars = history("AAPL", "2026-11-27", 200);
    const store = provider(async () => rows([["AAPL", bars]]));
    const quote = await store.getQuote("aapl");
    const last = bars.at(-1)!;
    const prior = bars.at(-2)!;
    expect(quote).toMatchObject({
      symbol: "AAPL",
      price: last.close,
      previousClose: prior.close,
      sessionDate: "2026-11-27",
      session: "closed",
      source: "delayed",
      asOf: "2026-11-27T18:00:00.000Z",
    });
    expect(quote.changePercent).toBeCloseTo(last.close / prior.close - 1, 12);
    await expect(store.getQuote("ZZZZ")).rejects.toThrow(/Unknown symbol/);
  });

  it("uses the NYSE calendar for the session", () => {
    const thanksgiving = provider(async () => rows([]), new Date("2026-11-26T16:00:00Z"));
    const session = thanksgiving.getSession();
    expect(session.status).toBe("closed");
    expect(session.lastCompletedDate).toBe("2026-11-25");
  });

  it("changes its data version when history is restated", async () => {
    let factor = 1;
    const store = new StoredMarketDataProvider({
      id: "polygon",
      displayName: "Polygon",
      symbols: ["AAPL"],
      clock: () => AFTER_EARLY_CLOSE,
      ttlMs: 0,
      load: async () =>
        rows([
          [
            "AAPL",
            history("AAPL", "2026-11-27", 200).map((bar) => fakeBar("AAPL", bar.date, factor)),
          ],
        ]),
    });
    const before = await store.getDataVersion();
    expect(await store.getDataVersion()).toBe(before);
    factor = 4;
    expect(await store.getDataVersion()).not.toBe(before);
  });

  it("shares one in-flight load between concurrent requests", async () => {
    const load = vi.fn(async () => rows([["AAPL", history("AAPL", "2026-11-27", 200)]]));
    const store = provider(load);
    await Promise.all([store.listAssets(), store.getQuote("AAPL"), store.getDailyBars("AAPL")]);
    expect(load).toHaveBeenCalledTimes(1);
    store.invalidate();
    await store.listAssets();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("feeds the universe analysis end to end", async () => {
    const store = provider(async () =>
      rows([
        ["AAPL", history("AAPL", "2026-11-27", 400)],
        ["MSFT", history("MSFT", "2026-11-27", 400)],
      ]),
    );
    const assets = await store.listAssets();
    const analysis = analyzeUniverse(
      await Promise.all(
        assets.map(async (asset) => ({
          profile: asset,
          bars: await store.getDailyBars(asset.symbol),
        })),
      ),
    );
    expect(analysis.asOf).toBe("2026-11-27");
    expect(analysis.assets).toHaveLength(2);
    for (const asset of analysis.assets) {
      expect(asset.signal.probabilityUp).toBeGreaterThan(0);
      expect(asset.signal.probabilityUp).toBeLessThan(1);
    }
  });
});
