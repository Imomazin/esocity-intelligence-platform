import { describe, expect, it } from "vitest";

import { getConfigurationIssues, parseServerEnv } from "@/lib/env";
import { summarizeInfrastructureError } from "@/lib/security/safe-error";

describe("environment parsing", () => {
  it("defaults to a runnable demo configuration", () => {
    const env = parseServerEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(env.DEMO_MODE).toBe(true);
    expect(env.MARKET_DATA_PROVIDER).toBe("demo");
    expect(env.BROKER_ADAPTER).toBe("paper");
    expect(getConfigurationIssues(env).filter((issue) => issue.severity === "error")).toHaveLength(
      0,
    );
  });

  it("rejects malformed values without echoing secrets", () => {
    const secret = "short";
    let message = "";
    try {
      parseServerEnv({
        NODE_ENV: "test",
        AUTH_SECRET: secret,
        DATABASE_URL: "mysql://x",
      } as NodeJS.ProcessEnv);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/AUTH_SECRET|DATABASE_URL/);
    expect(message).not.toContain(`"${secret}"`);
  });

  it("requires Upstash URL and token together", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "test",
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  it("flags production mode without database, auth or with a live broker", () => {
    const env = parseServerEnv({
      NODE_ENV: "production",
      DEMO_MODE: "false",
      BROKER_ADAPTER: "alpaca",
    } as NodeJS.ProcessEnv);
    const errors = getConfigurationIssues(env)
      .filter((issue) => issue.severity === "error")
      .map((i) => i.variable);
    expect(errors).toEqual(
      expect.arrayContaining(["DATABASE_URL", "AUTH_SECRET", "AUTH_PROVIDER", "BROKER_ADAPTER"]),
    );
  });
});

describe("licensed data provider configuration", () => {
  const issues = (source: Record<string, string>) =>
    getConfigurationIssues(parseServerEnv({ NODE_ENV: "test", ...source } as NodeJS.ProcessEnv));

  it("parses universes, leagues and quotas with defaults", () => {
    const env = parseServerEnv({
      NODE_ENV: "test",
      MARKET_DATA_SYMBOLS: " aapl, msft  brk.b,AAPL ",
      API_FOOTBALL_LEAGUES: "39, 140",
    } as NodeJS.ProcessEnv);
    expect(env.MARKET_DATA_SYMBOLS).toEqual(["AAPL", "MSFT", "BRK.B"]);
    expect(env.API_FOOTBALL_LEAGUES).toEqual([39, 140]);
    expect(env.POLYGON_REQUESTS_PER_MINUTE).toBe(5);
    expect(env.MARKET_DATA_BACKFILL_DAYS).toBe(730);

    const defaults = parseServerEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(defaults.MARKET_DATA_SYMBOLS).toContain("SPY");
    expect(defaults.API_FOOTBALL_LEAGUES).toEqual([39]);
  });

  it("rejects malformed symbols, league ids and insecure provider URLs", () => {
    for (const source of [
      { MARKET_DATA_SYMBOLS: "AAPL,<script>" },
      { API_FOOTBALL_LEAGUES: "39,premier" },
      { POLYGON_BASE_URL: "http://api.example.com" },
      { CRON_SECRET: "short" },
    ]) {
      expect(() => parseServerEnv({ NODE_ENV: "test", ...source } as NodeJS.ProcessEnv)).toThrow();
    }
    expect(
      parseServerEnv({
        NODE_ENV: "test",
        POLYGON_BASE_URL: "http://127.0.0.1:4010",
      } as NodeJS.ProcessEnv).POLYGON_BASE_URL,
    ).toBe("http://127.0.0.1:4010");
  });

  it("requires PostgreSQL for licensed providers and warns about missing keys", () => {
    const polygon = issues({ MARKET_DATA_PROVIDER: "polygon" });
    expect(polygon.find((issue) => issue.variable === "DATABASE_URL")?.severity).toBe("error");
    expect(polygon.find((issue) => issue.variable === "POLYGON_API_KEY")?.severity).toBe("warning");
    expect(polygon.find((issue) => issue.variable === "CRON_SECRET")?.severity).toBe("warning");

    const complete = issues({
      MARKET_DATA_PROVIDER: "polygon",
      SPORTS_DATA_PROVIDER: "api-football",
      DATABASE_URL: "postgresql://esocity:esocity_local_only@localhost:5432/esocity",
      POLYGON_API_KEY: "pk_0123456789abcdef",
      API_FOOTBALL_KEY: "af_0123456789abcdef",
      CRON_SECRET: "0123456789abcdef0123",
    });
    expect(complete.filter((issue) => issue.severity !== "info")).toEqual([]);
  });

  it("still refuses placeholder providers", () => {
    expect(
      issues({ MARKET_DATA_PROVIDER: "twelvedata", SPORTS_DATA_PROVIDER: "opta" })
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.variable),
    ).toEqual(["MARKET_DATA_PROVIDER", "SPORTS_DATA_PROVIDER"]);
  });
});

describe("safe error summaries", () => {
  it("never leaks hosts or credentials", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED 10.1.2.3:5432"), {
      code: "ECONNREFUSED",
    });
    expect(summarizeInfrastructureError(error)).toBe("Connection refused");
    const auth = Object.assign(new Error('password authentication failed for user "admin"'), {
      code: "28P01",
    });
    expect(summarizeInfrastructureError(auth)).toBe("Authentication failed");
    expect(summarizeInfrastructureError(new Error("could not reach db.internal.example"))).toBe(
      "Connection failed",
    );
  });
});
