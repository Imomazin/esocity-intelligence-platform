import { createHash, timingSafeEqual } from "node:crypto";

import { ConfigurationError, UnauthorizedError } from "@/lib/api/errors";

/**
 * Scheduled-job authentication. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the
 * CRON_SECRET environment variable is set; any other caller must present the same secret.
 * Digests are compared in constant time so response timing reveals nothing about the secret.
 */
export function assertCronAuthorized(header: string | null, secret: string | undefined): void {
  if (!secret) {
    throw new ConfigurationError("Scheduled ingestion is disabled: CRON_SECRET is not configured.");
  }
  const token = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "")?.[1];
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!token || !timingSafeEqual(digest(token), digest(secret))) {
    throw new UnauthorizedError("Invalid or missing cron credentials.");
  }
}
