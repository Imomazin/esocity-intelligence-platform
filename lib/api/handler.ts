import type { NextRequest } from "next/server";
import type { z } from "zod";

import {
  BadRequestError,
  ForbiddenError,
  RateLimitError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "@/lib/api/errors";
import { jsonError, zodIssues } from "@/lib/api/response";
import { checkRateLimit, clientIdentifier, type RateLimitPolicy } from "@/lib/security/rate-limit";

export interface HandlerContext<P> {
  request: NextRequest;
  params: P;
  requestId: string;
  clientId: string;
}

export interface RouteOptions {
  rateLimit?: RateLimitPolicy;
}

type EmptyParams = Record<string, never>;

/**
 * Wrap a Next.js Route Handler with the platform's cross-cutting concerns:
 * request ids, rate limiting, same-origin enforcement for writes and central error mapping
 * (AppError → status/code, ZodError → 400, anything else → opaque 500).
 */
export function apiRoute<P extends Record<string, string> = EmptyParams>(
  handler: (context: HandlerContext<P>) => Promise<Response>,
  options: RouteOptions = {},
) {
  return async function routeHandler(
    request: NextRequest,
    context: { params: Promise<P> },
  ): Promise<Response> {
    const requestId = crypto.randomUUID();
    try {
      const clientId = clientIdentifier(request.headers);

      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        assertSameOrigin(request);
      }

      if (options.rateLimit) {
        const result = await checkRateLimit(clientId, options.rateLimit);
        if (!result.success) throw new RateLimitError(result.resetSeconds);
      }

      const params = context?.params ? await context.params : ({} as P);
      const response = await handler({ request, params, requestId, clientId });
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      return jsonError(error, requestId);
    }
  };
}

/**
 * CSRF defence in depth: browsers always send `Origin` on cross-site POSTs. Reject writes whose
 * Origin does not match the host serving the API. Non-browser clients (no Origin) are allowed.
 */
export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError("Invalid Origin header.");
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host && originHost !== host) {
    throw new ForbiddenError("Cross-origin requests are not permitted.");
  }
}

const MAX_JSON_BYTES = 64 * 1024;

/** Parse and validate a JSON request body. */
export async function parseJsonBody<S extends z.ZodType>(
  request: NextRequest,
  schema: S,
): Promise<z.output<S>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new UnsupportedMediaTypeError();
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_JSON_BYTES) {
    throw new BadRequestError(`Request body exceeds ${MAX_JSON_BYTES} bytes.`);
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_JSON_BYTES) {
      throw new BadRequestError(`Request body exceeds ${MAX_JSON_BYTES} bytes.`);
    }
    body = text.length === 0 ? {} : JSON.parse(text);
  } catch (error) {
    if (error instanceof BadRequestError) throw error;
    throw new BadRequestError("Malformed JSON body.");
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError("Request body validation failed.", zodIssues(result.error));
  }
  return result.data;
}

/** Parse and validate URL query parameters. */
export function parseQuery<S extends z.ZodType>(request: NextRequest, schema: S): z.output<S> {
  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError("Query parameter validation failed.", zodIssues(result.error));
  }
  return result.data;
}

/** Validate a single path segment. */
export function parseParam<S extends z.ZodType>(
  value: unknown,
  schema: S,
  name: string,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`Invalid path parameter "${name}".`, zodIssues(result.error));
  }
  return result.data;
}
