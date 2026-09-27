import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createdAt, id, timestampTz, updatedAt } from "./columns";
import { riskProfile, themePreference, userRole } from "./enums";

export const users = pgTable(
  "users",
  {
    id: id(),
    email: varchar("email", { length: 320 }),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    role: userRole("role").notNull().default("analyst"),
    /** Demo-session users are created lazily in demo mode and can be purged safely. */
    isDemo: boolean("is_demo").notNull().default(false),
    /** External identity (e.g. "clerk" / "authjs") — attached when production auth ships. */
    authProvider: varchar("auth_provider", { length: 40 }),
    authSubject: varchar("auth_subject", { length: 255 }),
    lastSeenAt: timestampTz("last_seen_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_lower_unique").on(sql`lower(${t.email})`),
    uniqueIndex("users_auth_identity_unique").on(t.authProvider, t.authSubject),
    index("users_is_demo_idx").on(t.isDemo),
    check(
      "users_auth_identity_pair",
      sql`(${t.authProvider} is null) = (${t.authSubject} is null)`,
    ),
  ],
);

export const userPreferences = pgTable(
  "user_preferences",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    theme: themePreference("theme").notNull().default("system"),
    baseCurrency: char("base_currency", { length: 3 }).notNull().default("USD"),
    riskProfile: riskProfile("risk_profile").notNull().default("balanced"),
    defaultMarketSymbol: varchar("default_market_symbol", { length: 16 }),
    compactNumbers: boolean("compact_numbers").notNull().default(false),
    notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
    emailDigest: boolean("email_digest").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("user_preferences_user_unique").on(t.userId),
    check("user_preferences_currency_iso", sql`${t.baseCurrency} ~ '^[A-Z]{3}$'`),
  ],
);
