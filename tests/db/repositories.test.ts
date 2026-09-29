import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/db/client";
import { PostgresIngestionRunStore } from "@/db/repositories/ingestion-runs";
import {
  PostgresMarketDataRepository,
  readMarketCoverage,
  readMarketSnapshot,
} from "@/db/repositories/market-data";
import {
  PostgresSportsRepository,
  readFootballCoverage,
  readFootballSnapshot,
} from "@/db/repositories/sports-data";
import { assets, competitions, ingestionRuns, marketPrices, matches, teams } from "@/db/schema";
import { runIngestion, type IngestionContext } from "@/lib/ingestion/runner";
import { analyzeUniverse } from "@/lib/markets/analysis";
import { ingestMarketHistory } from "@/lib/markets/ingestion";
import { StoredMarketDataProvider } from "@/lib/markets/providers/stored-provider";
import { competitionKey, ingestFootball, matchRef, teamKey } from "@/lib/sports/ingestion";
import type { UpstreamTeam } from "@/lib/sports/providers/api-football";
import { buildFootballState } from "@/lib/sports/providers/stored-provider";
import { FakeHistorySource, fakeBar } from "@/tests/helpers/market-fakes";
import { FAKE_TEAMS, FakeFootballSource, fakeSeason } from "@/tests/helpers/sports-fakes";

/**
 * PostgreSQL integration tests — run with `TEST_DATABASE_URL=… pnpm test:db` against a migrated,
 * disposable database. Rows use dedicated test keys (symbols ZTST*, source "fake", league
 * 990001, offset team/fixture ids) and are removed afterwards; audit rows are append-only by
 * design and remain.
 */

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const SYMBOLS = ["ZTSTA", "ZTSTB"];
const LEAGUE = 990_001;
const TEAMS: UpstreamTeam[] = FAKE_TEAMS.map((team) => ({ ...team, id: team.id + 900_000 }));
// Monday 28 September 2026, after the US close.
const NOW = new Date("2026-09-28T22:00:00Z");

const context = (now: Date = NOW): IngestionContext => ({
  now: () => now,
  dryRun: false,
  outOfTime: () => false,
});

async function cleanupMarket() {
  const db = getDb();
  const assetRows = await db
    .select({ id: assets.id })
    .from(assets)
    .where(inArray(assets.symbol, SYMBOLS));
  if (assetRows.length > 0) {
    await db.delete(marketPrices).where(
      inArray(
        marketPrices.assetId,
        assetRows.map((row) => row.id),
      ),
    );
    await db.delete(assets).where(inArray(assets.symbol, SYMBOLS));
  }
}

async function cleanup() {
  const db = getDb();
  await cleanupMarket();
  const competitionRows = await db
    .select({ id: competitions.id })
    .from(competitions)
    .where(eq(competitions.key, competitionKey(LEAGUE)));
  if (competitionRows.length > 0) {
    await db.delete(matches).where(
      inArray(
        matches.competitionId,
        competitionRows.map((row) => row.id),
      ),
    );
    await db.delete(competitions).where(eq(competitions.key, competitionKey(LEAGUE)));
  }
  await db.delete(teams).where(
    inArray(
      teams.key,
      TEAMS.map((team) => teamKey(team.id)),
    ),
  );
  await db.delete(ingestionRuns).where(like(ingestionRuns.provider, "fake%"));
}

describe.skipIf(!enabled)("PostgreSQL repositories", () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await closeDb();
  });

  describe("market data", () => {
    it("stores, reads back and replaces bars at storage precision, isolated by source", async () => {
      const db = getDb();
      const repository = new PostgresMarketDataRepository(db);
      const asset = await repository.createAsset({
        symbol: "ZTSTA",
        name: "Test Asset A",
        assetClass: "equity",
        exchange: "NASDAQ",
        sector: "Services",
        industry: "Testing",
        currency: "USD",
        description: "Integration test asset.",
        metadata: { provider: "fake" },
      });
      const bars = ["2026-09-23", "2026-09-24", "2026-09-25"].map((date) => ({
        ...fakeBar("ZTSTA", date),
        close: 123.456789,
        high: 130,
        low: 90,
      }));
      expect(await repository.upsertBars(asset.id, "fake", bars)).toBe(3);
      // A demo-seeded bar on another date must never leak into the licensed series.
      await db.insert(marketPrices).values({
        assetId: asset.id,
        interval: "1d",
        ts: new Date("2026-09-22T00:00:00Z"),
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
        source: "demo",
      });

      expect(await repository.coverage(asset.id, "fake")).toEqual({
        first: "2026-09-23",
        last: "2026-09-25",
        count: 3,
      });
      expect(await repository.readBars(asset.id, "fake", "2026-09-24", "2026-09-30")).toEqual(
        bars.slice(1),
      );
      const snapshot = await readMarketSnapshot(db, "fake", ["ZTSTA"], "2026-01-01");
      expect(snapshot.bars.get("ZTSTA")?.map((bar) => bar.date)).toEqual([
        "2026-09-23",
        "2026-09-24",
        "2026-09-25",
      ]);
      expect(snapshot.profiles[0]).toMatchObject({ symbol: "ZTSTA", sector: "Services" });
      expect(await readMarketCoverage(db, "fake", ["ZTSTA", "ZTSTB"])).toEqual([
        { symbol: "ZTSTA", first: "2026-09-23", last: "2026-09-25", bars: 3 },
        { symbol: "ZTSTB", first: null, last: null, bars: 0 },
      ]);

      expect(await repository.replaceBars(asset.id, "fake", bars.slice(0, 2))).toBe(2);
      expect((await repository.coverage(asset.id, "fake")).count).toBe(2);
      expect(
        (await readMarketSnapshot(db, "demo", ["ZTSTA"], "2026-01-01")).bars.get("ZTSTA"),
      ).toHaveLength(1);
    });

    it("runs incremental ingestion end to end and serves the result", async () => {
      await cleanupMarket();
      const db = getDb();
      const source = new FakeHistorySource();
      const options = {
        source,
        repository: new PostgresMarketDataRepository(db),
        symbols: SYMBOLS,
        backfillDays: 400,
      };
      const store = new PostgresIngestionRunStore(db);
      const run = (now: Date) =>
        runIngestion({
          domain: "markets",
          provider: "fake",
          trigger: "manual",
          dryRun: false,
          store,
          now: () => now,
          work: (ctx) => ingestMarketHistory(options, ctx),
        });

      const first = await run(NOW);
      expect(first.status).toBe("succeeded");
      expect(first.items.map((item) => item.status)).toEqual(["updated", "updated"]);
      const again = await run(NOW);
      expect(again.items.map((item) => item.status)).toEqual(["unchanged", "unchanged"]);
      source.split = { symbol: "ZTSTB", factor: 2 };
      const split = await run(new Date("2026-09-29T21:30:00Z"));
      expect(split.items.map((item) => item.status)).toEqual(["updated", "restated"]);

      const runs = await store.recent("markets", 5);
      expect(runs.slice(0, 3).map((entry) => entry.status)).toEqual([
        "succeeded",
        "succeeded",
        "succeeded",
      ]);
      expect(runs[0]?.items).toHaveLength(2);

      const provider = new StoredMarketDataProvider({
        id: "fake",
        displayName: "Fake",
        symbols: SYMBOLS,
        clock: () => new Date("2026-09-29T21:30:00Z"),
        load: () => readMarketSnapshot(db, "fake", SYMBOLS, "2020-01-01"),
      });
      const profiles = await provider.listAssets();
      const analysis = analyzeUniverse(
        await Promise.all(
          profiles.map(async (profile) => ({
            profile,
            bars: await provider.getDailyBars(profile.symbol),
          })),
        ),
      );
      expect(analysis.asOf).toBe("2026-09-29");
      expect((await provider.getQuote("ZTSTB")).source).toBe("delayed");
    });
  });

  describe("ingestion lease", () => {
    it("allows one running run per domain and abandons stale ones", async () => {
      const store = new PostgresIngestionRunStore(getDb());
      const start = (startedAt: Date) =>
        store.start({
          domain: "sports",
          provider: "fake-lease",
          trigger: "manual",
          startedAt,
          staleAfterMs: 60_000,
        });
      const first = await start(NOW);
      expect(first).not.toBeNull();
      expect(await start(NOW)).toBeNull();

      const later = new Date(NOW.getTime() + 3_600_000);
      const second = await start(later);
      expect(second).not.toBeNull();
      await store.finish(second!.id, {
        status: "succeeded",
        finishedAt: later,
        requestCount: 1,
        rowsWritten: 0,
        items: [],
        warnings: [],
        error: null,
      });
      const statuses = (await store.recent("sports", 10))
        .filter((run) => run.provider === "fake-lease")
        .map((run) => run.status);
      expect(statuses).toEqual(["succeeded", "abandoned"]);
    });
  });

  describe("football data", () => {
    class TestFootballSource extends FakeFootballSource {
      override async fetchTeams(): Promise<UpstreamTeam[]> {
        await super.fetchTeams();
        return TEAMS;
      }
    }

    it("ingests, merges context and serves walk-forward state", async () => {
      const db = getDb();
      const source = new TestFootballSource();
      source.league = { ...source.league, leagueId: LEAGUE };
      source.seasons.set(2026, fakeSeason(TEAMS, "2026-08-15", NOW, 9_000_000));
      source.seasons.set(2025, fakeSeason(TEAMS, "2025-08-16", NOW, 9_005_000));
      const repository = new PostgresSportsRepository(db);
      const options = { source, repository, leagues: [LEAGUE] };

      const first = await ingestFootball(options, context());
      expect(first.items[0]?.status).toBe("updated");
      expect(first.items[0]?.rowsWritten).toBe(60);

      const finishedId = source.seasons.get(2026)!.find((f) => f.status === "finished")!.id;
      const [before] = await db
        .select()
        .from(matches)
        .where(eq(matches.externalRef, matchRef(finishedId)));
      expect(before?.context).toMatchObject({ provider: "api-football", xgChecked: true });

      // A re-run writes no fixtures and keeps separately merged context (xG, availability).
      const again = await ingestFootball(options, context());
      expect(again.items[0]?.rowsWritten).toBe(0);
      const [after] = await db
        .select()
        .from(matches)
        .where(eq(matches.externalRef, matchRef(finishedId)));
      expect(after?.context.xgChecked).toBe(true);

      const coverage = await readFootballCoverage(db, [competitionKey(LEAGUE)], NOW);
      expect(coverage).toEqual([
        expect.objectContaining({
          key: competitionKey(LEAGUE),
          season: "2026/27",
          fixtures: 30,
          finished: 21,
          overdue: 0,
        }),
      ]);
      expect(coverage[0]!.upcoming).toBeGreaterThan(0);
      expect(coverage[0]!.withXg).toBeGreaterThan(0);

      const rows = await readFootballSnapshot(db, [competitionKey(LEAGUE)]);
      expect(rows.competitions.map((row) => row.season).sort()).toEqual(["2025/26", "2026/27"]);
      const state = buildFootballState(rows, [competitionKey(LEAGUE)], NOW);
      expect(state.seasons[0]?.matches).toHaveLength(30);
      expect(state.seasons[0]?.standings[0]?.played).toBeGreaterThan(0);
      // Priors from last season move the opening fixture away from neutral ratings.
      expect(state.seasons[0]?.matches[0]?.context.home.attackRating).not.toBe(1);

      const [team] = await db
        .select()
        .from(teams)
        .where(and(eq(teams.key, teamKey(TEAMS[2]!.id))));
      expect(team).toMatchObject({ shortName: "Wolverhampton", code: "WOL" });
    });
  });
});
