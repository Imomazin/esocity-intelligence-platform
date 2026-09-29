import { describe, expect, it, vi } from "vitest";

import { runIngestion, type IngestionContext } from "@/lib/ingestion/runner";
import {
  changedBars,
  missingSessions,
  restatedDates,
  validateBars,
} from "@/lib/markets/bar-validation";
import { NYSE_CALENDAR } from "@/lib/markets/calendar";
import { ingestMarketHistory, type MarketIngestionOptions } from "@/lib/markets/ingestion";
import {
  mapPolygonProfile,
  PolygonHistorySource,
  sicDivision,
} from "@/lib/markets/providers/polygon";
import { findDemoAsset } from "@/lib/markets/universe";
import { ProviderError } from "@/lib/providers/errors";
import { FakeHistorySource, fakeBar, MemoryMarketRepository } from "@/tests/helpers/market-fakes";

// Monday 28 September 2026, 18:00 New York — after the close: the 28th is complete.
const AFTER_CLOSE = new Date("2026-09-28T22:00:00Z");
// Tuesday 29 September 2026, 11:00 New York — the 29th is still forming.
const NEXT_DAY_OPEN = new Date("2026-09-29T15:00:00Z");

function context(now: Date, overrides: Partial<IngestionContext> = {}): IngestionContext {
  return { now: () => now, dryRun: false, outOfTime: () => false, ...overrides };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function polygon(responses: Response[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return next;
  });
  const source = new PolygonHistorySource({
    apiKey: "pk_test_0123456789abcdef",
    http: { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => undefined },
  });
  return { source, calls };
}

describe("Polygon adapter", () => {
  it("reads split-adjusted daily aggregates in New York dates and follows pagination", async () => {
    const { source, calls } = polygon([
      json({
        status: "OK",
        results: [
          // 00:00 New York in EST (UTC−5) and EDT (UTC−4).
          { t: Date.parse("2026-01-05T05:00:00Z"), o: 10, h: 11, l: 9.5, c: 10.5, v: 1200.4 },
        ],
        next_url: "https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/x/y?cursor=abc",
      }),
      json({
        status: "DELAYED",
        results: [{ t: Date.parse("2026-09-25T04:00:00Z"), o: 20, h: 21, l: 19, c: 20.5, v: 5 }],
      }),
    ]);
    const bars = await source.fetchDailyBars("AAPL", "2026-01-01", "2026-09-25");
    expect(bars.map((bar) => bar.date)).toEqual(["2026-01-05", "2026-09-25"]);
    expect(calls[0]!.url).toContain("/v2/aggs/ticker/AAPL/range/1/day/2026-01-01/2026-09-25");
    expect(calls[0]!.url).toContain("adjusted=true");
    expect(calls[0]!.url).not.toContain("apiKey");
    expect(calls[0]!.headers.authorization).toBe("Bearer pk_test_0123456789abcdef");
    expect(calls[1]!.url).toBe(
      "https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/x/y?cursor=abc",
    );
    expect(source.requestCount).toBe(2);
  });

  it("rejects error statuses in a 200 response", async () => {
    const { source } = polygon([json({ status: "ERROR", error: "bad ticker" })]);
    await expect(source.fetchDailyBars("AAPL", "2026-01-01", "2026-01-31")).rejects.toThrow(
      /status ERROR — bad ticker/,
    );
  });

  it("maps reference data and treats unknown tickers as missing", async () => {
    const { source } = polygon([
      json({
        status: "OK",
        results: {
          ticker: "QQQ",
          name: "Invesco QQQ Trust, Series 1",
          type: "ETF",
          primary_exchange: "XNAS",
          currency_name: "usd",
        },
      }),
      json({ status: "NOT_FOUND", message: "Ticker not found." }, 404),
    ]);
    const profile = await source.fetchProfile("QQQ");
    expect(profile).toMatchObject({
      symbol: "QQQ",
      assetClass: "etf",
      exchange: "NASDAQ",
      sector: "Exchange-traded fund",
      currency: "USD",
    });
    await expect(source.fetchProfile("ZZZZ")).resolves.toBeNull();
  });

  it("derives sector and industry from SIC codes and refuses non-USD listings", () => {
    const profile = mapPolygonProfile({
      ticker: "AAPL",
      name: "Apple Inc.",
      type: "CS",
      primary_exchange: "XNAS",
      sic_code: "3571",
      sic_description: "ELECTRONIC COMPUTERS",
    });
    expect(profile?.sector).toBe("Manufacturing");
    expect(profile?.industry).toBe("Electronic Computers");
    expect(sicDivision("6022")).toBe("Finance, Insurance & Real Estate");
    expect(sicDivision("0050")).toBeNull();
    expect(mapPolygonProfile({ ticker: "SAP", name: "SAP", currency_name: "eur" })).toBeNull();
  });
});

describe("bar validation", () => {
  const calendar = NYSE_CALENDAR;

  it("defers unfinished sessions and rejects impossible bars", () => {
    const result = validateBars(
      [
        fakeBar("AAA", "2026-09-24"),
        { date: "2026-09-25", open: 10, high: 9, low: 11, close: 10, volume: 1 },
        { date: "2026-09-28", open: -1, high: 1, low: 1, close: 1, volume: 1 },
        fakeBar("AAA", "2026-09-29"),
        { date: "2026-02-30", open: 1, high: 1, low: 1, close: 1, volume: 1 },
      ],
      { through: "2026-09-28", calendar },
    );
    expect(result.bars.map((bar) => bar.date)).toEqual(["2026-09-24"]);
    expect(result.rejected.map((item) => item.reason)).toEqual([
      "inconsistent OHLC",
      "non-positive or non-finite price",
      "invalid date",
    ]);
  });

  it("repairs adjustment rounding, normalises precision and de-duplicates", () => {
    const result = validateBars(
      [
        { date: "2026-09-25", open: 10.1234567, high: 10.1, low: 9.9, close: 10, volume: 10.6 },
        { date: "2026-09-24", open: 9, high: 9.5, low: 8.5, close: 9, volume: 1 },
        { date: "2026-09-24", open: 9, high: 9.5, low: 8.5, close: 9.2, volume: 2 },
      ],
      { through: "2026-09-28", calendar },
    );
    expect(result.bars).toEqual([
      { date: "2026-09-24", open: 9, high: 9.5, low: 8.5, close: 9.2, volume: 2 },
      { date: "2026-09-25", open: 10.123457, high: 10.123457, low: 9.9, close: 10, volume: 11 },
    ]);
    expect(result.warnings.join(" ")).toMatch(/repaired/);
  });

  it("flags extreme moves, holiday bars and missing sessions", () => {
    const result = validateBars(
      [
        { date: "2026-09-21", open: 100, high: 101, low: 99, close: 100, volume: 1 },
        { date: "2026-09-23", open: 100, high: 101, low: 20, close: 25, volume: 1 },
        { date: "2026-11-26", open: 25, high: 26, low: 24, close: 25, volume: 1 },
      ],
      { through: "2026-12-31", calendar },
    );
    const text = result.warnings.join(" ");
    expect(text).toMatch(/One-day moves above 40% on 2026-09-23/);
    expect(text).toMatch(/non-trading days: 2026-11-26/);
    expect(text).toMatch(/Missing sessions: 2026-09-22/);
    expect(missingSessions(result.bars, calendar)).toContain("2026-09-24");
  });

  it("detects restated history and changed bars", () => {
    const stored = [fakeBar("AAA", "2026-09-24"), fakeBar("AAA", "2026-09-25")];
    const split = stored.map((bar) => fakeBar("AAA", bar.date, 4));
    expect(restatedDates(stored, split)).toEqual(["2026-09-24", "2026-09-25"]);
    const revisedVolume = [{ ...stored[1]!, volume: stored[1]!.volume + 1 }];
    expect(restatedDates(stored, revisedVolume)).toEqual([]);
    expect(changedBars(stored, [...revisedVolume, fakeBar("AAA", "2026-09-28")])).toHaveLength(2);
  });
});

describe("market ingestion", () => {
  function setup(symbols = ["AAPL", "ZZTEST"]) {
    const source = new FakeHistorySource();
    const repository = new MemoryMarketRepository();
    const options: MarketIngestionOptions = {
      source,
      repository,
      symbols,
      backfillDays: 120,
      curatedProfile: (symbol) => findDemoAsset(symbol)?.profile ?? null,
    };
    return { source, repository, options };
  }

  it("backfills completed sessions and creates assets from curated or provider reference data", async () => {
    const { source, repository, options } = setup();
    source.extra = [fakeBar("AAPL", "2026-09-29")]; // tomorrow's bar must never be stored
    const result = await ingestMarketHistory(options, context(AFTER_CLOSE));

    expect(result.items.map((item) => [item.key, item.status])).toEqual([
      ["AAPL", "updated"],
      ["ZZTEST", "updated"],
    ]);
    const aapl = repository.stored("asset-AAPL", "fake");
    expect(aapl.at(-1)?.date).toBe("2026-09-28");
    expect(aapl[0]!.date >= "2026-05-31").toBe(true);
    expect(repository.assets.get("AAPL")?.profile.metadata).toEqual({ referenceData: "curated" });
    expect(repository.assets.get("ZZTEST")?.profile.metadata).toEqual({ provider: "fake" });
    // Curated AAPL needs no reference-data call: 2 bar fetches + 1 profile fetch.
    expect(result.requestCount).toBe(3);
  });

  it("is idempotent within a session and appends the next completed session", async () => {
    const { repository, options } = setup(["MSFT"]);
    await ingestMarketHistory(options, context(AFTER_CLOSE));
    const again = await ingestMarketHistory(options, context(NEXT_DAY_OPEN));
    expect(again.items[0]).toMatchObject({ status: "unchanged", rowsWritten: 0 });
    expect(again.items[0]?.lastDataDate).toBe("2026-09-28");

    const nextEvening = new Date("2026-09-29T21:30:00Z");
    const later = await ingestMarketHistory(options, context(nextEvening));
    expect(later.items[0]).toMatchObject({ status: "updated", rowsWritten: 1 });
    expect(repository.stored("asset-MSFT", "fake").at(-1)?.date).toBe("2026-09-29");
  });

  it("re-ingests the full history when the provider restates it (split)", async () => {
    const { source, repository, options } = setup(["NVDA"]);
    await ingestMarketHistory(options, context(AFTER_CLOSE));
    const firstDate = repository.stored("asset-NVDA", "fake")[0]!.date;
    source.split = { symbol: "NVDA", factor: 4 };

    const result = await ingestMarketHistory(options, context(new Date("2026-09-29T21:30:00Z")));
    expect(result.items[0]?.status).toBe("restated");
    expect(repository.replaced).toBe(1);
    expect(source.fetches.at(-1)).toEqual({ symbol: "NVDA", from: firstDate, to: "2026-09-29" });
    const stored = repository.stored("asset-NVDA", "fake");
    expect(stored[0]!.close).toBeCloseTo(fakeBar("NVDA", firstDate, 4).close, 6);
    expect(stored.at(-1)?.date).toBe("2026-09-29");
  });

  it("records per-symbol failures and keeps going", async () => {
    const { source, options } = setup(["AAPL", "NOPE", "MSFT"]);
    source.unknown.add("NOPE");
    source.failing.set("MSFT", new ProviderError("fake", "/aggs responded 500", { status: 500 }));
    const result = await ingestMarketHistory(options, context(AFTER_CLOSE));
    expect(result.items.map((item) => item.status)).toEqual(["updated", "failed", "failed"]);
    expect(result.items[1]?.detail).toMatch(/no USD-listed instrument/);
  });

  it("aborts on authentication errors", async () => {
    const { source, options } = setup(["AAPL"]);
    source.failing.set("AAPL", new ProviderError("fake", "bad key", { kind: "auth", status: 401 }));
    await expect(ingestMarketHistory(options, context(AFTER_CLOSE))).rejects.toThrow(/bad key/);
  });

  it("skips the remaining symbols when the request budget or time runs out", async () => {
    const budget = setup(["AAPL", "MSFT", "NVDA"]);
    budget.source.failing.set(
      "MSFT",
      new ProviderError("fake", "budget", { kind: "budget_exhausted" }),
    );
    const byBudget = await ingestMarketHistory(budget.options, context(AFTER_CLOSE));
    expect(byBudget.items.map((item) => item.status)).toEqual(["updated", "skipped", "skipped"]);

    const time = setup(["AAPL", "MSFT"]);
    let calls = 0;
    const byTime = await ingestMarketHistory(
      time.options,
      context(AFTER_CLOSE, { outOfTime: () => ++calls > 1 }),
    );
    expect(byTime.items.map((item) => item.status)).toEqual(["updated", "skipped"]);
  });

  it("writes nothing on a dry run", async () => {
    const { repository, options } = setup(["AAPL"]);
    const result = await ingestMarketHistory(options, context(AFTER_CLOSE, { dryRun: true }));
    expect(result.items[0]?.detail).toMatch(/Dry run: \d+ bars would be stored/);
    expect(result.items[0]?.rowsWritten).toBe(0);
    expect(repository.assets.size).toBe(0);
  });

  it("reports run status through the runner", async () => {
    const { source, options } = setup(["AAPL", "NOPE"]);
    source.unknown.add("NOPE");
    const report = await runIngestion({
      domain: "markets",
      provider: "fake",
      trigger: "manual",
      dryRun: false,
      store: null,
      now: () => AFTER_CLOSE,
      work: (ctx) => ingestMarketHistory(options, ctx),
    });
    expect(report.status).toBe("partial");
    expect(report.rowsWritten).toBeGreaterThan(0);

    const failed = await runIngestion({
      domain: "markets",
      provider: "fake",
      trigger: "manual",
      dryRun: false,
      store: null,
      now: () => AFTER_CLOSE,
      work: async () => {
        throw new ProviderError("fake", "responded 401 — invalid key", { kind: "auth" });
      },
    });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("[fake] responded 401 — invalid key");
  });
});
