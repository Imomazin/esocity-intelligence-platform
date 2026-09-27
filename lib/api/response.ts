import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AppError, RateLimitError, type ErrorCode, type ValidationIssue } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

/**
 * Standard API envelopes.
 *
 *   Success: { "data": T, "meta": { requestId, generatedAt, ... } }
 *   Error:   { "error": { code, message, details? }, "meta": { requestId, generatedAt } }
 */

export interface ApiMeta {
  requestId: string;
  generatedAt: string;
  [key: string]: unknown;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
  meta: ApiMeta;
}

export function zodIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    message: issue.message,
  }));
}

export function jsonSuccess<T>(
  data: T,
  meta: { requestId: string; generatedAt?: string } & Record<string, unknown>,
  init: { status?: number; headers?: HeadersInit } = {},
): NextResponse<ApiSuccess<T>> {
  const body: ApiSuccess<T> = {
    data,
    meta: {
      ...meta,
      requestId: meta.requestId,
      generatedAt: meta.generatedAt ?? new Date().toISOString(),
    },
  };
  return NextResponse.json(body, { status: init.status ?? 200, headers: init.headers });
}

/** Map any thrown value to a safe JSON error response. Unknown errors never leak internals. */
export function jsonError(error: unknown, requestId: string): NextResponse<ApiErrorBody> {
  const meta: ApiMeta = { requestId, generatedAt: new Date().toISOString() };
  const headers = new Headers({ "x-request-id": requestId });

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR" as const,
          message: "Request validation failed.",
          details: zodIssues(error),
        },
        meta,
      },
      { status: 400, headers },
    );
  }

  if (error instanceof AppError) {
    if (error instanceof RateLimitError) {
      headers.set("Retry-After", String(error.retryAfterSeconds));
    }
    if (error.status >= 500) {
      logger.error("api.error", { requestId, code: error.code, error });
    }
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
        meta,
      },
      { status: error.status, headers },
    );
  }

  logger.error("api.unhandled_error", { requestId, error });
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR" as const,
        message: "An unexpected error occurred. Reference the request ID when reporting this.",
      },
      meta,
    },
    { status: 500, headers },
  );
}
