import { NotFoundError } from "@/lib/api/errors";
import { apiRoute, parseParam } from "@/lib/api/handler";
import { jsonSuccess } from "@/lib/api/response";
import { matchIdParamSchema } from "@/lib/api/schemas";
import { getServerEnv } from "@/lib/env";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { getSportsDataProvider } from "@/lib/sports/providers";

export const dynamic = "force-dynamic";

/** GET /api/sports/matches/:id — fixture, result (if finished) and pre-match context/inputs. */
export const GET = apiRoute<{ id: string }>(
  async ({ params, requestId }) => {
    const id = parseParam(params.id, matchIdParamSchema, "id");
    const provider = getSportsDataProvider();
    const match = await provider.getMatch(id);
    if (!match) throw new NotFoundError(`Unknown match "${id}".`);
    return jsonSuccess(match, {
      requestId,
      demoMode: getServerEnv().DEMO_MODE,
      provider: provider.id,
      simulated: provider.isSimulated,
    });
  },
  { rateLimit: RATE_LIMITS.read },
);
