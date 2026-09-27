import { backtestParamsSchema, runBacktestForParams } from "@/features/backtesting/queries";
import { listRecentBacktests, saveBacktestRun } from "@/db/repositories/backtests";
import { BadRequestError } from "@/lib/api/errors";
import { apiRoute, parseJsonBody } from "@/lib/api/handler";
import { jsonSuccess } from "@/lib/api/response";
import { readSession } from "@/lib/api/session-route";
import { STRATEGIES, STRATEGY_IDS } from "@/lib/backtesting/strategies";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/backtests — available strategies, defaults and (with a database) recent runs. */
export const GET = apiRoute(
  async ({ requestId }) => {
    const env = getServerEnv();
    let recent: Awaited<ReturnType<typeof listRecentBacktests>> = [];
    if (env.DATABASE_URL) {
      try {
        recent = await listRecentBacktests(10);
      } catch (error) {
        if (!env.DEMO_MODE) throw error;
        logger.error("backtests.list_failed", { error });
      }
    }
    return jsonSuccess(
      {
        strategies: STRATEGY_IDS.map((id) => ({
          id,
          name: STRATEGIES[id].name,
          description: STRATEGIES[id].description,
          rules: STRATEGIES[id].rules,
          parameters: STRATEGIES[id].parameters,
        })),
        defaults: backtestParamsSchema.parse({}),
        recent,
      },
      { requestId, demoMode: env.DEMO_MODE },
    );
  },
  { rateLimit: RATE_LIMITS.read },
);

/**
 * POST /api/backtests — run a backtest.
 * Body: { symbol, strategy, startDate?, endDate?, initialCapital?, feeBps?, slippageBps? }
 */
export const POST = apiRoute(
  async ({ request, requestId }) => {
    const env = getServerEnv();
    const params = await parseJsonBody(request, backtestParamsSchema);
    const session = readSession(request);
    const data = await runBacktestForParams(params, {
      audit: { actorId: session.demoSessionId, requestId },
    });
    if (data.error || !data.result)
      throw new BadRequestError(data.error ?? "Backtest could not be run.");

    let persistedId: string | null = null;
    if (env.DATABASE_URL) {
      try {
        persistedId = await saveBacktestRun(data.result, null);
      } catch (error) {
        if (!env.DEMO_MODE) throw error;
        logger.error("backtests.persist_failed", { error });
      }
    }

    return jsonSuccess(
      { id: persistedId, result: data.result },
      {
        requestId,
        demoMode: env.DEMO_MODE,
        engine: data.engine,
        disclaimer:
          "Simulated results on synthetic data. Past performance does not predict future results.",
      },
      { status: 201 },
    );
  },
  { rateLimit: RATE_LIMITS.backtests },
);
