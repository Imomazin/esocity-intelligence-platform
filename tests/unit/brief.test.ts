import { describe, expect, it } from "vitest";

import { buildIntelligenceBrief, type BriefAsset, type BriefInputs } from "@/lib/insights/brief";
import type { AssetForecast } from "@/lib/markets/forecast";
import type { SeasonProjection } from "@/lib/sports/season-simulation";

const forecast = (dailyNow: number, condition: "normal" | "elevated" = "normal") =>
  ({
    volatility: {
      dailyNow,
      dailyLongRun: 0.015,
      annualisedNow: dailyNow * Math.sqrt(252),
      annualisedLongRun: 0.24,
      horizon: 0.08,
      condition,
    },
  }) as unknown as AssetForecast;

const asset = (overrides: Partial<BriefAsset>): BriefAsset => ({
  symbol: "AAA",
  signal: "HOLD",
  score: 0,
  probabilityUp: 0.52,
  changePercent: 0.001,
  lastChange: null,
  regimeStatus: null,
  forecast: forecast(0.015),
  ...overrides,
});

const projection = {
  simulations: 10_000,
  remainingFixtures: 12,
  zones: { top: 2, bottom: 1 },
  teams: [
    { team: { key: "a", name: "Alpha" }, title: 0.46 },
    { team: { key: "b", name: "Beta" }, title: 0.38 },
  ],
  decisive: [
    {
      id: "m1",
      homeKey: "a",
      awayKey: "b",
      kickoffAt: "2026-10-03T14:00:00.000Z",
      teamKey: "a",
      ifHomeWin: 0.71,
      ifDraw: 0.44,
      ifAwayWin: 0.2,
      swing: 0.51,
    },
  ],
} as unknown as SeasonProjection;

const inputs: BriefInputs = {
  marketDate: "2026-09-28",
  now: new Date("2026-09-29T12:00:00Z"),
  horizonDays: 20,
  assets: [
    asset({
      symbol: "AMZN",
      signal: "BUY",
      score: 0.34,
      probabilityUp: 0.58,
      lastChange: { date: "2026-09-25", from: "HOLD", to: "BUY" },
    }),
    asset({ symbol: "TSLA", changePercent: -0.061, forecast: forecast(0.02, "elevated") }),
    asset({ symbol: "GOOGL", probabilityUp: 0.64 }),
    asset({ symbol: "MSFT", probabilityUp: 0.38 }),
    asset({
      symbol: "OLD",
      lastChange: { date: "2026-08-01", from: "SELL", to: "HOLD" },
    }),
  ],
  breadth: { aboveSma50: 7, assets: 8 },
  correlation: { averageCorrelation: 0.62, independentDrivers: 2.3, assets: 8 },
  competitions: [
    { key: "pd", name: "Premier Division", projection, teamNames: { a: "Alpha", b: "Beta" } },
  ],
  portfolio: {
    risk: {
      contributions: [
        { symbol: "TSLA", weight: 0.09, riskShare: 0.24, volatility: 0.5, beta: 1.4 },
        { symbol: "SPY", weight: 0.3, riskShare: 0.2, volatility: 0.15, beta: 1 },
      ],
      valueAtRisk: [
        {
          key: "95-1d",
          confidence: 0.95,
          horizonDays: 1,
          historical: { fraction: 0.021, amount: 1925 },
          expectedShortfall: { fraction: 0.03, amount: 2750 },
          parametric: { fraction: 0.02, amount: 1830 },
        },
      ],
    } as never,
    currentDrawdown: -0.12,
    largestPosition: { symbol: "SPY", weight: 0.3 },
  },
};

describe("intelligence brief", () => {
  const brief = buildIntelligenceBrief(inputs, 12);
  const byKind = (kind: string) => brief.filter((insight) => insight.kind === kind);

  it("explains recent signal changes and unusual moves", () => {
    const change = byKind("signal-change")[0]!;
    expect(change.title).toBe("AMZN moved to BUY");
    expect(change.detail).toContain("P(up, 20d) 58%");
    expect(brief.some((insight) => insight.id.includes("OLD"))).toBe(false);
    const move = byKind("unusual-move")[0]!;
    expect(move.title).toContain("TSLA moved −6.1%");
    expect(move.severity).toBe("notice");
  });

  it("covers sport and the paper portfolio", () => {
    expect(byKind("decisive-fixture")[0]!.detail).toContain("Alpha's title chance: 71%");
    expect(byKind("risk-concentration")[0]!.title).toContain("TSLA");
    expect(byKind("drawdown")[0]!.title).toContain("12.0%");
  });

  it("ranks by salience, caps each module at three and keeps one headline per asset", () => {
    const saliences = brief.map((insight) => insight.salience);
    expect([...saliences].sort((a, b) => b - a)).toEqual(saliences);
    for (const moduleKey of ["markets", "sports", "trade"]) {
      expect(brief.filter((insight) => insight.module === moduleKey).length).toBeLessThanOrEqual(3);
    }
    const assetLinks = brief
      .map((insight) => insight.href)
      .filter((href) => href.startsWith("/markets/"));
    expect(new Set(assetLinks).size).toBe(assetLinks.length);
    expect(buildIntelligenceBrief(inputs).length).toBeLessThanOrEqual(6);
  });

  it("never promises outcomes", () => {
    for (const insight of brief) {
      expect(`${insight.title} ${insight.detail}`).not.toMatch(
        /\bguaranteed\b|\bwill (rise|fall)\b|\bsure\b|\bbet(s|ting)?\b/i,
      );
    }
  });
});
