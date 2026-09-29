/**
 * Errors raised by external data providers (market data, sports data).
 *
 * Messages name the provider, the request path and the upstream status or reason. They never
 * contain credentials: API keys travel in request headers only and are redacted from any
 * upstream text quoted here.
 */

export type ProviderErrorKind =
  | "auth"
  | "not_found"
  | "rate_limited"
  | "upstream"
  | "network"
  | "timeout"
  | "invalid_response"
  | "budget_exhausted"
  | "configuration";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;

  constructor(
    public readonly providerId: string,
    message: string,
    options: { cause?: unknown; kind?: ProviderErrorKind; status?: number } = {},
  ) {
    super(`[${providerId}] ${message}`, { cause: options.cause });
    this.name = "ProviderError";
    this.kind = options.kind ?? "upstream";
    this.status = options.status;
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}
