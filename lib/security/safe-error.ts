/**
 * Reduce an infrastructure error to a short, non-sensitive summary that is safe to return from
 * public endpoints such as /api/health. Raw driver messages can contain hostnames, ports, user
 * names or connection-string fragments, so they are only ever written to server logs — never
 * to a response body.
 */
const CODE_SUMMARIES: Record<string, string> = {
  ECONNREFUSED: "Connection refused",
  ECONNRESET: "Connection reset",
  ENOTFOUND: "Host could not be resolved",
  EAI_AGAIN: "Host could not be resolved",
  ETIMEDOUT: "Connection timed out",
  CONNECT_TIMEOUT: "Connection timed out",
  CONNECTION_CLOSED: "Connection closed",
  CONNECTION_ENDED: "Connection closed",
  "28P01": "Authentication failed",
  "28000": "Authorisation rejected",
  "3D000": "Database does not exist",
  "42P01": "Schema missing — run migrations",
  "53300": "Too many connections",
  "57P03": "Database is starting up",
};

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") return code;
  const cause = (error as { cause?: unknown }).cause;
  return cause === undefined ? undefined : errorCode(cause);
}

export function summarizeInfrastructureError(error: unknown): string {
  const code = errorCode(error);
  if (code && CODE_SUMMARIES[code]) return CODE_SUMMARIES[code];
  const message = error instanceof Error ? error.message : "";
  if (/timed out|timeout/i.test(message)) return "Timed out";
  if (/certificate|ssl|tls/i.test(message)) return "TLS negotiation failed";
  if (/unauthori[sz]ed|forbidden|401|403/i.test(message)) return "Authentication failed";
  return "Connection failed";
}
