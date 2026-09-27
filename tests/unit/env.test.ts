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
