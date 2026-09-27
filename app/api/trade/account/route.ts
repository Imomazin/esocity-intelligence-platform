import { z } from "zod";

import { getPaperTradingViewForAccount, resetPaperAccount } from "@/features/trade/service";
import { apiRoute, parseJsonBody } from "@/lib/api/handler";
import { jsonSuccess } from "@/lib/api/response";
import { readSession, writableSession } from "@/lib/api/session-route";
import { getServerEnv } from "@/lib/env";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/trade/account — paper account summary, risk and storage status. */
export const GET = apiRoute(
  async ({ request, requestId }) => {
    const session = readSession(request);
    const view = await getPaperTradingViewForAccount(session.demoSessionId);
    return jsonSuccess(
      {
        mode: view.mode,
        account: view.account,
        broker: view.broker,
        storage: view.storage,
        summary: view.summary,
        risk: view.risk,
        exposure: view.exposure,
        history: view.history,
      },
      { requestId, demoMode: getServerEnv().DEMO_MODE, paperTradingOnly: true },
    );
  },
  { rateLimit: RATE_LIMITS.read },
);

const resetSchema = z.object({
  action: z.literal("reset"),
  mode: z.enum(["demo", "cash"]).default("demo"),
});

/** POST /api/trade/account { "action": "reset", "mode": "demo" | "cash" } */
export const POST = apiRoute(
  async ({ request, requestId, clientId }) => {
    const body = await parseJsonBody(request, resetSchema);
    const { sessionId, applyCookie } = writableSession(request);
    const owner = { accountId: sessionId, ownerId: sessionId };
    await resetPaperAccount(owner, body.mode, {
      requestId,
      ipAddress: clientId,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    const view = await getPaperTradingViewForAccount(sessionId);
    return applyCookie(
      jsonSuccess(
        { mode: view.mode, summary: view.summary, storage: view.storage },
        { requestId, demoMode: getServerEnv().DEMO_MODE, paperTradingOnly: true },
      ),
    );
  },
  { rateLimit: RATE_LIMITS.orders },
);
