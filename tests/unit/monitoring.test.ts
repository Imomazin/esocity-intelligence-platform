import { describe, expect, it } from "vitest";

import {
  assessCompetition,
  assessMarketPipeline,
  assessSportsPipeline,
  assessSymbol,
} from "@/lib/ingestion/monitoring";
import type { IngestionRunRecord } from "@/lib/ingestion/types";

// Tuesday 7 April 2026, 21:00 UTC (after the close): the last completed session is 7 April.
const NOW = new Date("2026-04-07T21:00:00Z");

const run = (overrides: Partial<IngestionRunRecord>): IngestionRunRecord => ({
  id: crypto.randomUUID(),
  domain: "markets",
  provider: "polygon",
  trigger: "schedule",
  status: "succeeded",
  startedAt: "2026-04-06T22:30:00.000Z",
  finishedAt: "2026-04-06T22:32:00.000Z",
  requestCount: 8,
  rowsWritten: 8,
  items: [],
  warnings: [],
  error: null,
  ...overrides,
});

describe("market freshness", () => {
  it("tolerates one session of lag and counts sessions across holidays", () => {
    // 6 April is the Monday after Good Friday: one session behind 7 April → fresh.
    expect(
      assessSymbol({ symbol: "A", first: "2024-01-02", last: "2026-04-06", bars: 500 }, NOW),
    ).toMatchObject({
      expectedDate: "2026-04-07",
      sessionsBehind: 1,
      status: "fresh",
      servable: true,
    });
    // 2 April (Thursday before Good Friday): 6 and 7 April missing → stale.
    expect(
      assessSymbol({ symbol: "B", first: "2024-01-02", last: "2026-04-02", bars: 500 }, NOW),
    ).toMatchObject({
      sessionsBehind: 2,
      status: "stale",
    });
    expect(assessSymbol({ symbol: "C", first: null, last: null, bars: 0 }, NOW).status).toBe(
      "missing",
    );
    expect(
      assessSymbol({ symbol: "D", first: "2026-01-02", last: "2026-04-07", bars: 60 }, NOW)
        .servable,
    ).toBe(false);
  });

  it("aggregates to ok, degraded or down", () => {
    const fresh = { symbol: "A", first: "2024-01-02", last: "2026-04-07", bars: 500 };
    expect(assessMarketPipeline([fresh], [run({})], NOW).status).toBe("ok");
    expect(
      assessMarketPipeline([fresh, { ...fresh, symbol: "B", last: "2026-03-30" }], [run({})], NOW)
        .status,
    ).toBe("degraded");
    expect(assessMarketPipeline([fresh], [run({ status: "failed" })], NOW)).toMatchObject({
      status: "degraded",
      summary: expect.stringContaining("last run failed"),
    });
    expect(
      assessMarketPipeline([{ symbol: "A", first: null, last: null, bars: 0 }], [], NOW),
    ).toMatchObject({
      status: "down",
      summary: "0/1 symbols servable · no bars stored",
    });
  });

  it("ignores a run still in progress when reporting the last run", () => {
    const assessment = assessMarketPipeline(
      [{ symbol: "A", first: "2024-01-02", last: "2026-04-07", bars: 500 }],
      [run({ status: "running", finishedAt: null }), run({ status: "partial" })],
      NOW,
    );
    expect(assessment.lastRun?.status).toBe("partial");
    expect(assessment.lastSuccess?.status).toBe("partial");
  });
});

describe("sports freshness", () => {
  const competition = {
    key: "apif-l39",
    name: "Premier League",
    season: "2025/26",
    fixtures: 380,
    finished: 310,
    upcoming: 70,
    overdue: 0,
    withXg: 300,
    lastResult: "2026-04-05",
    lastUpdated: "2026-04-07T06:00:00Z",
  };
  const recent = run({ domain: "sports", finishedAt: "2026-04-07T06:05:00.000Z" });

  it("computes expected-goals coverage and flags overdue results", () => {
    expect(assessCompetition(competition).xgCoverage).toBeCloseTo(300 / 310, 10);
    expect(assessCompetition({ ...competition, overdue: 3 }).status).toBe("stale");
    expect(assessCompetition({ ...competition, fixtures: 0 }).status).toBe("missing");
  });

  it("is degraded when results are overdue or ingestion has not run for 36 hours", () => {
    expect(assessSportsPipeline([competition], [recent], NOW).status).toBe("ok");
    expect(assessSportsPipeline([{ ...competition, overdue: 2 }], [recent], NOW).summary).toContain(
      "2 results overdue",
    );
    const old = run({ domain: "sports", finishedAt: "2026-04-05T06:05:00.000Z" });
    expect(assessSportsPipeline([competition], [old], NOW).status).toBe("degraded");
    expect(assessSportsPipeline([{ ...competition, fixtures: 0 }], [], NOW).status).toBe("down");
  });
});
