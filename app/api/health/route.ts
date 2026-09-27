import { apiRoute } from "@/lib/api/handler";
import { jsonSuccess } from "@/lib/api/response";
import { getHealthReport } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness + dependency status for uptime monitors and the Admin console.
 * 200 when ok/degraded, 503 when a required dependency or configuration is failing.
 */
export const GET = apiRoute(async ({ requestId }) => {
  const report = await getHealthReport();
  return jsonSuccess(
    report,
    { requestId, demoMode: report.demoMode },
    { status: report.status === "down" ? 503 : 200 },
  );
});
