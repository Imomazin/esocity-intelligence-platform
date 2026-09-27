import { getMarketOverview } from "@/features/markets/queries";
import { apiRoute } from "@/lib/api/handler";
import { jsonSuccess } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/markets — universe overview with latest simulated quotes and composite signals. */
export const GET = apiRoute(
  async ({ requestId }) => {
    const overview = await getMarketOverview();
    return jsonSuccess(overview, {
      requestId,
      demoMode: getServerEnv().DEMO_MODE,
      provider: overview.provider.id,
      simulated: overview.provider.isSimulated,
      disclaimer: "Model-generated signals are not personalised financial advice.",
    });
  },
  { rateLimit: RATE_LIMITS.read },
);
