import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { UnauthorizedError } from "@/lib/api/errors";
import {
  buildDemoSession,
  createDemoSessionId,
  DEMO_SESSION_COOKIE,
  demoSessionCookieOptions,
  isValidDemoSessionId,
} from "@/lib/auth/demo";
import type { PlatformSession } from "@/lib/auth/types";
import { getServerEnv } from "@/lib/env";

/**
 * Session resolution — THE attach point for production authentication.
 *
 * Demo mode (DEMO_MODE=true): every visitor gets the demo identity (see lib/auth/demo.ts).
 *
 * Production mode (DEMO_MODE=false): no provider ships in this release, so `getSession()`
 * returns null and the platform shell redirects to the landing page. To attach a provider:
 *
 *   Clerk   → wrap app/layout.tsx in <ClerkProvider>, add `clerkMiddleware()` in proxy.ts, and
 *             here call `const { userId } = await auth()` then load/create the `users` row by
 *             (auth_provider = "clerk", auth_subject = userId).
 *   Auth.js → export { auth } from an `auth.ts` config (AUTH_SECRET required), call
 *             `const session = await auth()` here and map session.user to SessionUser.
 *
 * Both paths are documented step-by-step in docs/SECURITY.md → "Authentication".
 */
export async function getSession(): Promise<PlatformSession | null> {
  if (getServerEnv().DEMO_MODE) {
    const cookieStore = await cookies();
    const sid = cookieStore.get(DEMO_SESSION_COOKIE)?.value;
    return buildDemoSession(isValidDemoSessionId(sid) ? sid : null);
  }
  return null;
}

export async function requireSession(): Promise<PlatformSession> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

/**
 * For Server Actions: guarantee the demo visitor has a session id, creating the cookie on
 * first write. (Cookies can only be set from Server Actions and Route Handlers.)
 */
export async function ensureWritableSession(): Promise<
  PlatformSession & { demoSessionId: string }
> {
  const session = await requireSession();
  if (session.mode !== "demo") {
    throw new UnauthorizedError("Authenticated write sessions are not configured.");
  }
  if (session.demoSessionId) return { ...session, demoSessionId: session.demoSessionId };

  const sid = createDemoSessionId();
  const cookieStore = await cookies();
  cookieStore.set(DEMO_SESSION_COOKIE, sid, demoSessionCookieOptions());
  const created = buildDemoSession(sid);
  return { ...created, demoSessionId: sid };
}

/** Route Handler variant: resolves the session from the incoming request's cookies. */
export function getSessionFromRequest(request: NextRequest): PlatformSession | null {
  if (!getServerEnv().DEMO_MODE) return null;
  const sid = request.cookies.get(DEMO_SESSION_COOKIE)?.value;
  return buildDemoSession(isValidDemoSessionId(sid) ? sid : null);
}
