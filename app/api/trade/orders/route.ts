import { z } from "zod";

import { executePaperOrder, getPaperTradingViewForAccount } from "@/features/trade/service";
import { OrderRejectedError } from "@/lib/api/errors";
import { apiRoute, parseJsonBody, parseQuery } from "@/lib/api/handler";
import { jsonError, jsonSuccess } from "@/lib/api/response";
import { limitQuerySchema } from "@/lib/api/schemas";
import { readSession, writableSession } from "@/lib/api/session-route";
import { getServerEnv } from "@/lib/env";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { orderRequestSchema } from "@/lib/trade/order-validation";

export const dynamic = "force-dynamic";

const listSchema = z.object({
  status: z.enum(["all", "filled", "rejected"]).default("all"),
  limit: limitQuerySchema.default(100),
});

/** GET /api/trade/orders?status=all&limit=100 — paper order history, newest first. */
export const GET = apiRoute(
  async ({ request, requestId }) => {
    const query = parseQuery(request, listSchema);
    const session = readSession(request);
    const view = await getPaperTradingViewForAccount(session.demoSessionId);
    const orders = view.orders.filter(
      (order) => query.status === "all" || order.status === query.status.toUpperCase(),
    );
    return jsonSuccess(
      { mode: view.mode, orders: orders.slice(0, query.limit) },
      { requestId, demoMode: getServerEnv().DEMO_MODE, paperTradingOnly: true },
    );
  },
  { rateLimit: RATE_LIMITS.read },
);

/**
 * POST /api/trade/orders — place a PAPER market order.
 *   201 Created           order filled (simulated)
 *   400 Validation error  malformed request
 *   422 ORDER_REJECTED    business rule failed (quantity, symbol, cash, position); the
 *                         rejected order is still recorded in the account history.
 */
export const POST = apiRoute(
  async ({ request, requestId, clientId }) => {
    const body = await parseJsonBody(request, orderRequestSchema);
    const { sessionId, applyCookie } = writableSession(request);
    const result = await executePaperOrder({ accountId: sessionId, ownerId: sessionId }, body, {
      requestId,
      ipAddress: clientId,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    if (result.order.status === "REJECTED") {
      return applyCookie(
        jsonError(
          new OrderRejectedError(result.message, {
            reason: result.order.rejectionReason ?? "REJECTED",
            order: result.order,
          }),
          requestId,
        ),
      );
    }

    return applyCookie(
      jsonSuccess(
        {
          order: result.order,
          message: result.message,
          estimate: result.estimate,
          storage: result.storage,
        },
        { requestId, demoMode: getServerEnv().DEMO_MODE, paperTradingOnly: true },
        { status: 201 },
      ),
    );
  },
  { rateLimit: RATE_LIMITS.orders },
);
