import { afterEach, describe, expect, it } from "vitest";

import { GET as ingest } from "@/app/api/cron/ingest/[domain]/route";
import { resetServerEnvCache } from "@/lib/env";
import { setMarketDataProviderForTesting } from "@/lib/markets/providers";
import { call } from "@/tests/helpers/api";

const SECRET = "cron-secret-0123456789abcdef";
const overridden: string[] = [];

function setEnv(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    overridden.push(key);
    process.env[key] = value;
  }
  resetServerEnvCache();
  setMarketDataProviderForTesting(null);
}

afterEach(() => {
  for (const key of overridden.splice(0)) delete process.env[key];
  process.env.MARKET_DATA_PROVIDER = "demo";
  resetServerEnvCache();
  setMarketDataProviderForTesting(null);
});

describe("GET /api/cron/ingest/:domain", () => {
  it("does nothing for demo providers, without requiring credentials", async () => {
    const { status, body } = await call(ingest, { params: { domain: "markets" } });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ domain: "markets", status: "skipped" });
  });

  it("rejects unknown domains", async () => {
    const { status, body } = await call(ingest, { params: { domain: "weather" } });
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("is disabled until CRON_SECRET is configured", async () => {
    setEnv({ MARKET_DATA_PROVIDER: "polygon" });
    const { status, body } = await call(ingest, {
      params: { domain: "markets" },
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(status).toBe(503);
    expect(body.error.code).toBe("CONFIGURATION_ERROR");
    expect(body.error.message).toMatch(/CRON_SECRET/);
  });

  it("rejects missing or wrong credentials", async () => {
    setEnv({ MARKET_DATA_PROVIDER: "polygon", CRON_SECRET: SECRET });
    const attempts: Record<string, string>[] = [
      {},
      { authorization: "Bearer wrong-secret-value" },
      { authorization: SECRET },
    ];
    for (const headers of attempts) {
      const { status, body } = await call(ingest, { params: { domain: "markets" }, headers });
      expect(status).toBe(401);
      expect(body.error.code).toBe("UNAUTHORIZED");
    }
  });

  it("runs once authenticated (here: stops at the missing database)", async () => {
    setEnv({
      MARKET_DATA_PROVIDER: "polygon",
      CRON_SECRET: SECRET,
      POLYGON_API_KEY: "pk_0123456789",
    });
    const { status, body } = await call(ingest, {
      params: { domain: "markets" },
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(status).toBe(503);
    expect(body.error.message).toMatch(/DATABASE_URL/);
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
});
