export type UserRole = "viewer" | "analyst" | "admin";

export interface SessionUser {
  id: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  isDemo: boolean;
}

export interface PlatformSession {
  mode: "demo" | "authenticated";
  user: SessionUser;
  /**
   * Demo sessions only: the anonymous per-browser id (httpOnly cookie) that scopes paper
   * trading state. `null` until the visitor performs their first write.
   */
  demoSessionId: string | null;
}
