import { getAssetDetail } from "@/features/markets/queries";
import { NotFoundError } from "@/lib/api/errors";
import { apiRoute, parseParam } from "@/lib/api/handler";
import { jsonSuccess } from "@/lib/api/response";
import { symbolParamSchema } from "@/lib/api/schemas";
import { getServerEnv } from "@/lib/env";
import { SIGNAL_MODEL_VERSION, SIGNAL_WEIGHTS } from "@/lib/markets/signal-engine";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/markets/:symbol/signal — the explainable composite signal: components, weights,
 * thresholds, confidence, calibrated P(up), regime, recent signal changes, and (when the Python
 * ML service is configured) its supplementary gradient-boosting view.
 */
export const GET = apiRoute<{ symbol: string }>(
  async ({ params, requestId }) => {
    const symbol = parseParam(params.symbol, symbolParamSchema, "symbol");
    const detail = await getAssetDetail(symbol);
    if (!detail) throw new NotFoundError(`Unknown symbol "${symbol}".`);

    return jsonSuccess(
      {
        symbol: detail.profile.symbol,
        modelVersion: SIGNAL_MODEL_VERSION,
        weights: SIGNAL_WEIGHTS,
        signal: detail.signal,
        risk: detail.risk,
        history: detail.signalHistory,
        calibration: detail.calibration,
        mlSupplement: detail.mlSupplement,
      },
      {
        requestId,
        demoMode: getServerEnv().DEMO_MODE,
        engine: detail.engine,
        disclaimer: "Probabilistic, model-generated signal. Not personalised financial advice.",
      },
    );
  },
  { rateLimit: RATE_LIMITS.read },
);
