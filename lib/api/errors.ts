/**
 * Application error hierarchy. Every error carries a stable machine-readable `code`, an HTTP
 * status and a message that is SAFE to show to API consumers. Internal detail belongs in the
 * `cause` (logged server-side only), never in `message`.
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "ORDER_REJECTED"
  | "RATE_LIMITED"
  | "CONFIGURATION_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface ValidationIssue {
  path: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    options: { details?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = options.details;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super("BAD_REQUEST", message, 400, { details });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, issues: ValidationIssue[]) {
    super("VALIDATION_ERROR", message, 400, { details: issues });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required.") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found.") {
    super("NOT_FOUND", message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = "Request body must be JSON (Content-Type: application/json).") {
    super("UNSUPPORTED_MEDIA_TYPE", message, 415);
  }
}

export class OrderRejectedError extends AppError {
  constructor(message: string, details: { reason: string; [key: string]: unknown }) {
    super("ORDER_REJECTED", message, 422, { details });
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("RATE_LIMITED", "Too many requests. Please retry shortly.", 429, {
      details: { retryAfterSeconds },
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super("CONFIGURATION_ERROR", message, 503, { cause });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "A required service is temporarily unavailable.", cause?: unknown) {
    super("SERVICE_UNAVAILABLE", message, 503, { cause });
  }
}

/** Licensed data is configured but not available yet (nothing ingested, or the store is down). */
export class DataUnavailableError extends ServiceUnavailableError {}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
