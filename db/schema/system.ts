import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";

import { createdAt, id, timestampTz } from "./columns";
import { auditActorType, auditOutcome, notificationSeverity, notificationType } from "./enums";
import { users } from "./users";

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    severity: notificationSeverity("severity").notNull().default("info"),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull(),
    link: varchar("link", { length: 500 }),
    readAt: timestampTz("read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    index("notifications_unread_idx")
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
  ],
);

/**
 * Append-only audit trail. `actor_id` is deliberately NOT a foreign key: audit records must
 * outlive the users they describe. Migration 0001 installs a trigger that rejects UPDATE and
 * DELETE on this table.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    occurredAt: timestampTz("occurred_at").notNull().defaultNow(),
    actorType: auditActorType("actor_type").notNull(),
    actorId: varchar("actor_id", { length: 64 }),
    action: varchar("action", { length: 80 }).notNull(),
    resourceType: varchar("resource_type", { length: 60 }),
    resourceId: varchar("resource_id", { length: 120 }),
    outcome: auditOutcome("outcome").notNull(),
    requestId: varchar("request_id", { length: 64 }),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: varchar("user_agent", { length: 400 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_events_occurred_idx").on(t.occurredAt),
    index("audit_events_actor_idx").on(t.actorId, t.occurredAt),
    index("audit_events_resource_idx").on(t.resourceType, t.resourceId),
    index("audit_events_action_idx").on(t.action),
  ],
);
