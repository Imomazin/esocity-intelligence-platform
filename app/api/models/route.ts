import { getModelLabView } from "@/features/model-lab/queries";
import { apiRoute } from "@/lib/api/handler";
import { jsonSuccess } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/models — model cards with live evaluation metrics and ML service status. */
export const GET = apiRoute(
  async ({ requestId }) => {
    const view = await getModelLabView();
    return jsonSuccess(
      {
        models: view.entries.map((entry) => ({
          ...entry.card,
          lastEvaluated: entry.lastEvaluated,
          evaluationNote: entry.evaluationNote,
          runtimeStatus: entry.runtimeStatus,
          metrics: entry.metrics,
          calibration: entry.calibration,
        })),
        mlService: view.mlService,
      },
      { requestId, demoMode: getServerEnv().DEMO_MODE },
    );
  },
  { rateLimit: RATE_LIMITS.read },
);
