import type { NextRequest, NextResponse } from "next/server";

import { UnauthorizedError } from "@/lib/api/errors";
import {
  createDemoSessionId,
  DEMO_SESSION_COOKIE,
  demoSessionCookieOptions,
} from "@/lib/auth/demo";
import { getSessionFromRequest } from "@/lib/auth/session";

/**
 * Route-handler session helpers. Reads the demo session from the request cookie; for writes,
 * mints a session id when absent and returns a hook that sets the cookie on the response.
 */
export function readSession(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) throw new UnauthorizedError();
  return session;
}

export function writableSession(request: NextRequest): {
  sessionId: string;
  applyCookie: (response: NextResponse) => NextResponse;
} {
  const session = readSession(request);
  if (session.demoSessionId) {
    return { sessionId: session.demoSessionId, applyCookie: (response) => response };
  }
  const sessionId = createDemoSessionId();
  return {
    sessionId,
    applyCookie: (response) => {
      response.cookies.set(DEMO_SESSION_COOKIE, sessionId, demoSessionCookieOptions());
      return response;
    },
  };
}
