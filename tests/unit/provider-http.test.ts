import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ProviderError } from "@/lib/providers/errors";
import { parseRetryAfter, ProviderHttpClient } from "@/lib/providers/http";

const SECRET = "test-provider-credential-0123456789";
const payload = z.object({ value: z.number() });

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

/** Deterministic clock: `sleep` advances time instead of waiting. */
function harness(responses: (Response | Error)[], options: Record<string, unknown> = {}) {
  let time = 1_000_000;
  const sleeps: number[] = [];
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  });
  const client = new ProviderHttpClient({
    providerId: "test",
    baseUrl: "https://api.example.com",
    headers: { authorization: `Bearer ${SECRET}` },
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    now: () => time,
    ...options,
  });
  return { client, calls, sleeps, fetchImpl };
}

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }
  throw new Error("expected a ProviderError");
}

describe("ProviderHttpClient", () => {
  it("authenticates with headers only and validates the payload", async () => {
    const { client, calls } = harness([json({ value: 42 })]);
    await expect(client.getJson("/v1/thing", payload, { a: 1, skip: undefined })).resolves.toEqual({
      value: 42,
    });
    expect(calls[0]!.url).toBe("https://api.example.com/v1/thing?a=1");
    expect(calls[0]!.url).not.toContain(SECRET);
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  it("re-bases provider-supplied absolute URLs onto the configured origin", async () => {
    const { client, calls } = harness([json({ value: 1 })]);
    await client.getJson("https://attacker.example.net/v2/next?cursor=abc", payload);
    expect(calls[0]!.url).toBe("https://api.example.com/v2/next?cursor=abc");
  });

  it("retries 429 honouring Retry-After, then succeeds", async () => {
    const { client, sleeps } = harness([
      json({ error: "slow down" }, { status: 429, headers: { "retry-after": "7" } }),
      json({ value: 3 }),
    ]);
    await expect(client.getJson("/x", payload)).resolves.toEqual({ value: 3 });
    expect(sleeps).toContain(7_000);
    expect(client.requestCount).toBe(2);
  });

  it("gives up on persistent 5xx after the retry budget", async () => {
    const { client, fetchImpl } = harness(
      [
        json({}, { status: 503 }),
        json({}, { status: 503 }),
        json({ message: "maintenance" }, { status: 503 }),
      ],
      { maxRetries: 2 },
    );
    const error = await failure(client.getJson("/x", payload));
    expect(error.kind).toBe("upstream");
    expect(error.status).toBe(503);
    expect(error.message).toContain("maintenance");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry authentication failures and never echoes the key", async () => {
    const { client, fetchImpl } = harness([
      json({ status: "ERROR", error: `Unknown API Key ${SECRET}` }, { status: 401 }),
    ]);
    const error = await failure(client.getJson("/x", payload));
    expect(error.kind).toBe("auth");
    expect(error.message).not.toContain(SECRET);
    expect(error.message).toContain("[REDACTED]");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports schema mismatches with the failing field", async () => {
    const { client } = harness([json({ value: "not a number" })]);
    const error = await failure(client.getJson("/x", payload));
    expect(error.kind).toBe("invalid_response");
    expect(error.message).toMatch(/value/);
  });

  it("reports malformed JSON", async () => {
    const { client } = harness([new Response("<html>oops</html>", { status: 200 })]);
    expect((await failure(client.getJson("/x", payload))).kind).toBe("invalid_response");
  });

  it("retries network errors and then reports them", async () => {
    const { client } = harness([new TypeError("fetch failed"), new TypeError("fetch failed")], {
      maxRetries: 1,
    });
    expect((await failure(client.getJson("/x", payload))).kind).toBe("network");
  });

  it("classifies timeouts", async () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const { client } = harness([timeout], { maxRetries: 0 });
    expect((await failure(client.getJson("/x", payload))).kind).toBe("timeout");
  });

  it("paces requests to respect per-minute quotas", async () => {
    const { client, sleeps } = harness([json({ value: 1 }), json({ value: 2 })], {
      minIntervalMs: 12_000,
    });
    await client.getJson("/a", payload);
    await client.getJson("/b", payload);
    expect(sleeps).toEqual([12_000]);
  });

  it("enforces the request budget without calling the provider", async () => {
    const { client, fetchImpl } = harness([json({ value: 1 })], { maxRequests: 1 });
    await client.getJson("/a", payload);
    const error = await failure(client.getJson("/b", payload));
    expect(error.kind).toBe("budget_exhausted");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(client.remainingRequests).toBe(0);
  });

  it("parses Retry-After dates", () => {
    const now = Date.parse("2026-09-28T12:00:00Z");
    expect(parseRetryAfter("Mon, 28 Sep 2026 12:00:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });
});
