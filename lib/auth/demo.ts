import type { PlatformSession } from "@/lib/auth/types";

/**
 * DEMO MODE identity.
 *
 * Demo mode is NOT authentication. Every visitor is the same fictional "Demo Analyst"; an
 * anonymous random id in an httpOnly cookie only isolates one browser's paper-trading state
 * from another's. No passwords, no PII, no privileged data exists in demo mode.
 */

export const DEMO_SESSION_COOKIE = "esocity_demo_sid";
export const DEMO_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Stable id used for read-only previews before a visitor has a session cookie. */
export const DEMO_PREVIEW_USER_ID = "00000000-0000-4000-8000-00000000d3e0";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidDemoSessionId(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

export function createDemoSessionId(): string {
  return crypto.randomUUID();
}

export function demoSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEMO_SESSION_MAX_AGE_SECONDS,
  };
}

export function buildDemoSession(demoSessionId: string | null): PlatformSession {
  return {
    mode: "demo",
    demoSessionId,
    user: {
      id: demoSessionId ?? DEMO_PREVIEW_USER_ID,
      displayName: "Demo Analyst",
      email: null,
      // Demo visitors can view the (read-only) admin console; there is nothing privileged in it.
      role: "admin",
      isDemo: true,
    },
  };
}
