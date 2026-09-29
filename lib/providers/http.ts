import type { z } from "zod";

import { ProviderError, type ProviderErrorKind } from "@/lib/providers/errors";

/**
 * Hardened JSON-over-HTTPS client shared by the licensed data provider adapters.
 *
 *   • Credentials go in request headers only — never in URLs — and are redacted from any
 *     upstream text echoed in an error.
 *   • Absolute URLs returned by a provider (pagination links) are re-based onto the configured
 *     origin, so credentials can never be sent to another host.
 *   • Per-request timeout; bounded retries with exponential back-off for network errors,
 *     timeouts, 429 and 5xx, honouring Retry-After.
 *   • Client-side pacing (minimum spacing between requests) for per-minute quotas and a request
 *     budget for per-day quotas: one client instance is meant to live for one ingestion run.
 *   • Every payload is validated with Zod; a schema mismatch is a typed error naming the field.
 */

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface ProviderHttpClientOptions {
  providerId: string;
  baseUrl: string;
  /** Sent with every request (authentication). Never logged or echoed in errors. */
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Retries after the first attempt for retryable failures. */
  maxRetries?: number;
  /** Minimum spacing between request starts, e.g. 12 000 ms for five requests per minute. */
  minIntervalMs?: number;
  /** Maximum requests over the client's lifetime (a per-run budget). */
  maxRequests?: number;
  /** Upper bound on any single back-off wait, including Retry-After. */
  maxBackoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const BASE_BACKOFF_MS = 1_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function classifyStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "upstream";
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/** Retry-After as delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

function summariseIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export class ProviderHttpClient {
  private readonly origin: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly secrets: string[];
  private queue: Promise<void> = Promise.resolve();
  private lastStartedAt = Number.NEGATIVE_INFINITY;
  private requests = 0;

  constructor(private readonly options: ProviderHttpClientOptions) {
    this.origin = new URL(options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    // Header values and bare bearer tokens are redacted from anything echoed in an error.
    this.secrets = Object.values(options.headers ?? {})
      .flatMap((value) => [value, value.replace(/^Bearer\s+/i, "")])
      .filter((value) => value.length >= 8);
  }

  get providerId(): string {
    return this.options.providerId;
  }

  /** Requests started so far (including retries). */
  get requestCount(): number {
    return this.requests;
  }

  get remainingRequests(): number {
    return (this.options.maxRequests ?? Number.POSITIVE_INFINITY) - this.requests;
  }

  private error(
    message: string,
    options: { kind: ProviderErrorKind; status?: number; cause?: unknown },
  ): ProviderError {
    return new ProviderError(this.options.providerId, this.redact(message), options);
  }

  private redact(text: string): string {
    return this.secrets.reduce((current, secret) => current.split(secret).join("[REDACTED]"), text);
  }

  /** Resolve a relative path or a provider-returned absolute URL against the configured origin. */
  resolveUrl(pathOrUrl: string, query: QueryParams = {}): URL {
    let url: URL;
    if (/^https?:\/\//i.test(pathOrUrl)) {
      const absolute = new URL(pathOrUrl);
      url = new URL(`${absolute.pathname}${absolute.search}`, this.origin);
    } else {
      url = new URL(pathOrUrl.replace(/^\//, ""), this.origin);
    }
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return url;
  }

  /** Serialise request starts: enforce spacing and the request budget. */
  private acquireSlot(path: string): Promise<void> {
    const slot = this.queue.then(async () => {
      if (this.requests >= (this.options.maxRequests ?? Number.POSITIVE_INFINITY)) {
        throw this.error(`request budget of ${this.options.maxRequests} exhausted before ${path}`, {
          kind: "budget_exhausted",
        });
      }
      const wait = this.lastStartedAt + (this.options.minIntervalMs ?? 0) - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStartedAt = this.now();
      this.requests += 1;
    });
    this.queue = slot.catch(() => undefined);
    return slot;
  }

  private backoff(attempt: number): number {
    const exponential = BASE_BACKOFF_MS * 2 ** (attempt - 1);
    return Math.min(this.options.maxBackoffMs ?? 60_000, exponential + Math.random() * 250);
  }

  private async upstreamDetail(response: Response): Promise<string> {
    try {
      const text = (await response.text()).slice(0, 2_000);
      let detail = text;
      try {
        const body = JSON.parse(text) as Record<string, unknown>;
        const candidate = body.error ?? body.message ?? body.errors;
        detail = typeof candidate === "string" ? candidate : JSON.stringify(candidate ?? body);
      } catch {
        // Not JSON — keep the raw (truncated) text.
      }
      return this.redact(detail.replace(/\s+/g, " ").trim()).slice(0, 200);
    } catch {
      return "";
    }
  }

  /** GET a JSON document and validate it. Throws ProviderError on any failure. */
  async getJson<S extends z.ZodType>(
    pathOrUrl: string,
    schema: S,
    query: QueryParams = {},
  ): Promise<z.output<S>> {
    const url = this.resolveUrl(pathOrUrl, query);
    const label = url.pathname;
    const maxRetries = this.options.maxRetries ?? 3;
    const timeoutMs = this.options.timeoutMs ?? 15_000;

    for (let attempt = 0; ; attempt++) {
      await this.acquireSlot(label);

      let response: Response;
      let text: string;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: { accept: "application/json", ...this.options.headers },
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
        if (!response.ok) {
          if (isRetryableStatus(response.status) && attempt < maxRetries) {
            const retryAfter = parseRetryAfter(response.headers.get("retry-after"), this.now());
            await response.body?.cancel().catch(() => undefined);
            await this.sleep(
              Math.min(
                this.options.maxBackoffMs ?? 60_000,
                retryAfter ?? this.backoff(attempt + 1),
              ),
            );
            continue;
          }
          const detail = await this.upstreamDetail(response);
          throw this.error(`${label} responded ${response.status}${detail ? ` — ${detail}` : ""}`, {
            kind: classifyStatus(response.status),
            status: response.status,
          });
        }
        const declared = Number(response.headers.get("content-length") ?? 0);
        if (declared > MAX_RESPONSE_BYTES) {
          await response.body?.cancel().catch(() => undefined);
          throw this.error(`${label} response exceeds ${MAX_RESPONSE_BYTES} bytes`, {
            kind: "invalid_response",
          });
        }
        text = await response.text();
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        // Network failure or timeout, while connecting or while reading the body.
        const timedOut =
          error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        if (attempt < maxRetries) {
          await this.sleep(this.backoff(attempt + 1));
          continue;
        }
        throw this.error(
          timedOut
            ? `${label} timed out after ${timeoutMs} ms`
            : `${label} failed: ${error instanceof Error ? error.message : "network error"}`,
          { kind: timedOut ? "timeout" : "network", cause: error },
        );
      }

      if (text.length > MAX_RESPONSE_BYTES) {
        throw this.error(`${label} response exceeds ${MAX_RESPONSE_BYTES} bytes`, {
          kind: "invalid_response",
        });
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch (error) {
        throw this.error(`${label} returned malformed JSON`, {
          kind: "invalid_response",
          cause: error,
        });
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw this.error(
          `${label} returned an unexpected payload (${summariseIssues(parsed.error)})`,
          {
            kind: "invalid_response",
          },
        );
      }
      return parsed.data;
    }
  }
}
