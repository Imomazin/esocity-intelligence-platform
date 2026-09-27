import { z } from "zod";

import { getAssetDetail } from "@/features/markets/queries";
import { NotFoundError } from "@/lib/api/errors";
import { apiRoute, parseParam, parseQuery } from "@/lib/api/handler";
import { jsonSuccess } from "@/lib/api/response";
import { symbolParamSchema } from "@/lib/api/schemas";
import { getServerEnv } from "@/lib/env";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const RANGE_BARS = { "1m": 21, "3m": 63, "6m": 126, "1y": 252, "2y": 504 } as const;

const querySchema = z.object({
  range: z.enum(["1m", "3m", "6m", "1y", "2y"]).default("1y"),
});

/** GET /api/markets/:symbol?range=1y — profile, quote, indicators, risk and price history. */
export const GET = apiRoute<{ symbol: string }>(
  async ({ request, params, requestId }) => {
    const symbol = parseParam(params.symbol, symbolParamSchema, "symbol");
    const { range } = parseQuery(request, querySchema);
    const detail = await getAssetDetail(symbol);
    if (!detail) throw new NotFoundError(`Unknown symbol "${symbol}".`);

    return jsonSuccess(
      {
        profile: detail.profile,
        quote: detail.quote,
        performance: detail.performance,
        risk: detail.risk,
        indicators: detail.indicators,
        range,
        bars: detail.chart.slice(-RANGE_BARS[range]),
      },
      { requestId, demoMode: getServerEnv().DEMO_MODE, simulated: detail.provider.isSimulated },
    );
  },
  { rateLimit: RATE_LIMITS.read },
);
