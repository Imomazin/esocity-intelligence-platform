import { describe, expect, it } from "vitest";

import { GET as getBacktests, POST as postBacktest } from "@/app/api/backtests/route";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getMarket } from "@/app/api/markets/[symbol]/route";
import { GET as getSignal } from "@/app/api/markets/[symbol]/signal/route";
import { GET as getMarkets } from "@/app/api/markets/route";
import { GET as getModels } from "@/app/api/models/route";
import { GET as getPrediction } from "@/app/api/sports/matches/[id]/prediction/route";
import { GET as getMatch } from "@/app/api/sports/matches/[id]/route";
import { GET as getMatches } from "@/app/api/sports/matches/route";
import { GET as getAccount } from "@/app/api/trade/account/route";
import { GET as getOrders, POST as postOrder } from "@/app/api/trade/orders/route";
import { GET as getPositions } from "@/app/api/trade/positions/route";
import { call, sessionCookieFrom } from "@/tests/helpers/api";

describe("GET /api/health", () => {
  it("reports ok in demo mode with no optional dependencies", async () => {
    const { status, body, headers } = await call(getHealth);
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.data.status).toBe("ok");
    expect(body.data.checks.database.status).toBe("not_configured");
    expect(body.meta.requestId).toBe(headers.get("x-request-id"));
  });
});

describe("markets API", () => {
  it("lists the universe", async () => {
    const { status, body } = await call(getMarkets);
    expect(status).toBe(200);
    expect(body.data.assets.map((asset: { symbol: string }) => asset.symbol)).toEqual(
      expect.arrayContaining(["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "SPY"]),
    );
  });

  it("returns an asset and a probabilistic signal", async () => {
    const asset = await call(getMarket, { url: "/api/markets/nvda", params: { symbol: "nvda" } });
    expect(asset.status).toBe(200);
    const signal = await call(getSignal, {
      url: "/api/markets/NVDA/signal",
      params: { symbol: "NVDA" },
    });
    expect(signal.status).toBe(200);
    expect(["BUY", "HOLD", "SELL"]).toContain(signal.body.data.signal.signal);
    expect(signal.body.data.signal.probabilityUp).toBeGreaterThan(0);
    expect(signal.body.data.signal.probabilityUp).toBeLessThan(1);
  });

  it("404s unknown symbols and 400s malformed ones", async () => {
    expect((await call(getSignal, { params: { symbol: "ZZZZ" } })).status).toBe(404);
    const bad = await call(getSignal, { params: { symbol: "<script>" } });
    expect(bad.status).toBe(400);
    expect(bad.body.data).toBeUndefined();
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("sports API", () => {
  it("lists fixtures and returns a normalised prediction", async () => {
    const list = await call(getMatches, { url: "/api/sports/matches?status=upcoming&limit=5" });
    expect(list.status).toBe(200);
    const id = list.body.data.matches[0].id as string;
    const match = await call(getMatch, { params: { id } });
    expect(match.status).toBe(200);
    const prediction = await call(getPrediction, { params: { id } });
    expect(prediction.status).toBe(200);
    const { outcome, scoreMatrix } = prediction.body.data.prediction;
    expect(outcome.home + outcome.draw + outcome.away).toBeCloseTo(1, 9);
    expect(scoreMatrix.flat().reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("404s unknown matches and 400s invalid filters", async () => {
    expect((await call(getPrediction, { params: { id: "pd-r99-xxx-yyy" } })).status).toBe(404);
    expect((await call(getMatches, { url: "/api/sports/matches?limit=0" })).status).toBe(400);
  });
});

describe("paper trading API", () => {
  it("previews the demo account without a session", async () => {
    const { status, body } = await call(getAccount);
    expect(status).toBe(200);
    expect(body.data.mode).toBe("preview");
    expect((await call(getPositions)).status).toBe(200);
  });

  it("fills a valid order (201) and sets an anonymous session cookie", async () => {
    const { status, body, headers } = await call(postOrder, {
      url: "/api/trade/orders",
      body: { symbol: "aapl", side: "BUY", quantity: 1 },
    });
    expect(status).toBe(201);
    expect(body.data.order.status).toBe("FILLED");
    expect(body.meta.paperTradingOnly).toBe(true);
    const cookie = sessionCookieFrom(headers);
    expect(cookie).toMatch(/^esocity_demo_sid=/);
    expect(headers.get("set-cookie")).toMatch(/HttpOnly/i);

    const orders = await call(getOrders, { url: "/api/trade/orders", cookie });
    expect(orders.body.data.mode).toBe("persisted");
    expect(
      orders.body.data.orders.some((order: { id: string }) => order.id === body.data.order.id),
    ).toBe(true);
  });

  it.each([
    [{ symbol: "AAPL", side: "BUY", quantity: 0 }, "INVALID_QUANTITY"],
    [{ symbol: "AAPL", side: "BUY", quantity: 2.5 }, "INVALID_QUANTITY"],
    [{ symbol: "ZZZZ", side: "BUY", quantity: 1 }, "UNKNOWN_SYMBOL"],
    [{ symbol: "NVDA", side: "BUY", quantity: 90_000 }, "INSUFFICIENT_CASH"],
    [{ symbol: "AMZN", side: "SELL", quantity: 99_999 }, "INSUFFICIENT_POSITION"],
  ])("rejects %o with 422 %s", async (order, reason) => {
    const { status, body } = await call(postOrder, { url: "/api/trade/orders", body: order });
    expect(status).toBe(422);
    expect(body.error.code).toBe("ORDER_REJECTED");
    expect(body.error.details.reason).toBe(reason);
  });

  it("400s malformed bodies, 415s non-JSON and 403s cross-origin writes", async () => {
    expect(
      (await call(postOrder, { body: { symbol: "AAPL", side: "HOLD", quantity: 1 } })).status,
    ).toBe(400);
    expect(
      (
        await call(postOrder, {
          body: { symbol: "AAPL", side: "BUY", quantity: 1 },
          headers: { "content-type": "text/plain" },
        })
      ).status,
    ).toBe(415);
    const cross = await call(postOrder, {
      body: { symbol: "AAPL", side: "BUY", quantity: 1 },
      headers: { origin: "https://evil.example" },
    });
    expect(cross.status).toBe(403);
  });
});

describe("backtests and models API", () => {
  it("lists strategies and runs a backtest", async () => {
    const list = await call(getBacktests);
    expect(list.status).toBe(200);
    expect(list.body.data.strategies).toHaveLength(3);
    const run = await call(postBacktest, { body: { symbol: "SPY", strategy: "sma_crossover" } });
    expect(run.status).toBe(201);
    expect(run.body.data.result.metrics.tradingDays).toBeGreaterThan(20);
  });

  it("validates backtest input", async () => {
    expect(
      (await call(postBacktest, { body: { symbol: "SPY", strategy: "martingale" } })).status,
    ).toBe(400);
  });

  it("publishes model cards", async () => {
    const { status, body } = await call(getModels);
    expect(status).toBe(200);
    expect(JSON.stringify(body.data)).toContain("sports.poisson-dixon-coles");
  });
});
