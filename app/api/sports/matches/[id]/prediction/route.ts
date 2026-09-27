import { NotFoundError } from "@/lib/api/errors";
import { apiRoute, parseParam } from "@/lib/api/handler";
import { jsonSuccess } from "@/lib/api/response";
import { matchIdParamSchema } from "@/lib/api/schemas";
import { getServerEnv } from "@/lib/env";
import { getIntelligenceEngine } from "@/lib/ml/engine";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { getSportsDataProvider } from "@/lib/sports/providers";

export const dynamic = "force-dynamic";

/**
 * GET /api/sports/matches/:id/prediction — Poisson/Dixon–Coles prediction: 1X2, expected goals,
 * 0–6 score matrix, goals markets, BTTS, clean sheets, confidence, uncertainty and the full
 * expected-goals derivation. Served by the ML API when configured, otherwise locally.
 */
export const GET = apiRoute<{ id: string }>(
  async ({ params, requestId }) => {
    const id = parseParam(params.id, matchIdParamSchema, "id");
    const match = await getSportsDataProvider().getMatch(id);
    if (!match) throw new NotFoundError(`Unknown match "${id}".`);
    const { prediction, engine } = await getIntelligenceEngine().predictMatch(match.modelInputs);
    return jsonSuccess(
      {
        matchId: match.id,
        status: match.status,
        kickoffAt: match.kickoffAt,
        home: match.homeTeam.name,
        away: match.awayTeam.name,
        inputs: match.modelInputs,
        prediction,
      },
      {
        requestId,
        demoMode: getServerEnv().DEMO_MODE,
        engine,
        disclaimer:
          "Probabilistic model estimate — not a guaranteed outcome and not betting advice.",
      },
    );
  },
  { rateLimit: RATE_LIMITS.read },
);
