export const AUDIT_ACTIONS = [
  "demo_session.started",
  "paper_account.created",
  "paper_account.reset",
  "paper_order.filled",
  "paper_order.rejected",
  "backtest.run",
  "model.evaluated",
  "preferences.updated",
  "ingestion.run",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditActorType = "user" | "demo" | "system" | "service";
export type AuditOutcome = "success" | "failure";

export interface AuditEventInput {
  action: AuditAction;
  actorType: AuditActorType;
  actorId?: string | null;
  resourceType?: string;
  resourceId?: string;
  outcome: AuditOutcome;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditEvent extends AuditEventInput {
  id: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
}
