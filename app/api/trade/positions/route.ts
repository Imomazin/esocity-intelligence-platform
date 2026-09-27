import { getPaperTradingViewForAccount } from "@/features/trade/service";
import { apiRoute } from "@/lib/api/handler";
import { jsonSuccess } from "@/lib/api/response";
import { readSession } from "@/lib/api/session-route";
import { getServerEnv } from "@/lib/env";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/trade/positions — open positions (marked to simulated prices) and closed positions. */
export const GET = apiRoute(
  async ({ request, requestId }) => {
    const session = readSession(request);
    const view = await getPaperTradingViewForAccount(session.demoSessionId);
    return jsonSuccess(
      {
        mode: view.mode,
        positions: view.positions,
        closedPositions: view.closedPositions,
        cash: view.summary.cash,
        totalValue: view.summary.totalValue,
      },
      { requestId, demoMode: getServerEnv().DEMO_MODE, paperTradingOnly: true },
    );
  },
  { rateLimit: RATE_LIMITS.read },
);
