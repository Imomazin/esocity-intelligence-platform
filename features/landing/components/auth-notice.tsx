"use client";

import { Lock } from "lucide-react";
import { useSearchParams } from "next/navigation";

/**
 * Shown when the platform redirected here because production mode has no signed-in user
 * (`/?auth=required`). Read on the client so the landing page itself stays static.
 */
export function AuthNotice() {
  const params = useSearchParams();
  if (params.get("auth") !== "required") return null;
  return (
    <div
      role="status"
      className="mx-auto mb-8 flex max-w-3xl items-start gap-3 rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-left text-sm"
    >
      <Lock className="mt-0.5 size-4 shrink-0 text-status-warning-text" aria-hidden />
      <p>
        <span className="font-semibold">Sign-in required.</span> This deployment runs in production
        mode, where the platform is available to authenticated users only. Contact your
        administrator for access.
      </p>
    </div>
  );
}
