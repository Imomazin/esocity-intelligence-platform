import { desc } from "drizzle-orm";

import { getDb } from "@/db/client";
import { auditEvents } from "@/db/schema";
import type { AuditEvent, AuditEventInput } from "@/lib/audit/types";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

export type { AuditAction, AuditEvent, AuditEventInput } from "@/lib/audit/types";

/**
 * Audit trail.
 *
 * Every security- or money-relevant action (paper orders, account resets, backtests, …) emits
 * an AuditEvent. Sinks:
 *   1. Structured log line (always) — shipped by Vercel log drains.
 *   2. In-memory ring buffer (always) — powers the Admin console in demo deployments.
 *   3. PostgreSQL `audit_events` (when DATABASE_URL is set) — append-only via DB trigger.
 *
 * In production mode a failed database write is re-thrown (the calling action fails rather
 * than proceeding un-audited). In demo mode it is logged as an error and the action proceeds.
 */

const SENSITIVE_KEY = /secret|token|password|passwd|authorization|api[-_]?key|cookie/i;
const BUFFER_SIZE = 200;

const globalForAudit = globalThis as unknown as { __esocityAuditBuffer?: AuditEvent[] };

function buffer(): AuditEvent[] {
  globalForAudit.__esocityAuditBuffer ??= [];
  return globalForAudit.__esocityAuditBuffer;
}

export function redactMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : value,
    ]),
  );
}

export async function recordAuditEvent(input: AuditEventInput): Promise<AuditEvent> {
  const event: AuditEvent = {
    ...input,
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    userAgent: input.userAgent?.slice(0, 400),
    metadata: redactMetadata(input.metadata),
  };

  const ring = buffer();
  ring.unshift(event);
  if (ring.length > BUFFER_SIZE) ring.length = BUFFER_SIZE;

  logger.info("audit", {
    action: event.action,
    outcome: event.outcome,
    actorType: event.actorType,
    actorId: event.actorId ?? null,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    requestId: event.requestId,
  });

  const env = getServerEnv();
  if (env.DATABASE_URL) {
    try {
      await getDb()
        .insert(auditEvents)
        .values({
          id: event.id,
          occurredAt: new Date(event.occurredAt),
          actorType: event.actorType,
          actorId: event.actorId ?? null,
          action: event.action,
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          outcome: event.outcome,
          requestId: event.requestId,
          ipAddress: event.ipAddress,
          userAgent: event.userAgent,
          metadata: event.metadata,
        });
    } catch (error) {
      logger.error("audit.persist_failed", { action: event.action, error });
      if (!env.DEMO_MODE) throw error;
    }
  }

  return event;
}

/** Most recent audit events — PostgreSQL when configured, otherwise this instance's buffer. */
export async function listRecentAuditEvents(limit = 50): Promise<{
  events: AuditEvent[];
  source: "database" | "memory";
}> {
  if (getServerEnv().DATABASE_URL) {
    try {
      const rows = await getDb()
        .select()
        .from(auditEvents)
        .orderBy(desc(auditEvents.occurredAt))
        .limit(limit);
      return {
        source: "database",
        events: rows.map((row) => ({
          id: row.id,
          occurredAt: row.occurredAt.toISOString(),
          action: row.action as AuditEvent["action"],
          actorType: row.actorType,
          actorId: row.actorId,
          resourceType: row.resourceType ?? undefined,
          resourceId: row.resourceId ?? undefined,
          outcome: row.outcome,
          requestId: row.requestId ?? undefined,
          ipAddress: row.ipAddress ?? undefined,
          userAgent: row.userAgent ?? undefined,
          metadata: row.metadata,
        })),
      };
    } catch (error) {
      logger.error("audit.list_failed", { error });
      if (!getServerEnv().DEMO_MODE) throw error;
    }
  }
  return { source: "memory", events: buffer().slice(0, limit) };
}
