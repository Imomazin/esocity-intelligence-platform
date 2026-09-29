import { z } from "zod";

import { summariseMatch } from "@/features/sports/queries";
import { apiRoute, parseQuery } from "@/lib/api/handler";
import { jsonSuccess } from "@/lib/api/response";
import { limitQuerySchema } from "@/lib/api/schemas";
import { getNow } from "@/lib/clock";
import { getServerEnv } from "@/lib/env";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { getSportsDataProvider } from "@/lib/sports/providers";
import type { MatchStatus } from "@/lib/sports/types";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.enum(["upcoming", "live", "finished", "all"]).default("upcoming"),
  competition: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,60}$/, "Invalid competition key")
    .optional(),
  limit: limitQuerySchema.default(50),
});

const STATUS_FILTER: Record<string, MatchStatus[] | undefined> = {
  upcoming: ["scheduled"],
  live: ["live"],
  finished: ["finished"],
  all: undefined,
};

/** GET /api/sports/matches?status=upcoming&competition=premier-division&limit=50 */
export const GET = apiRoute(
  async ({ request, requestId }) => {
    const query = parseQuery(request, querySchema);
    const provider = getSportsDataProvider();
    const [competitions, matches] = await Promise.all([
      provider.listCompetitions(),
      provider.listMatches({
        status: STATUS_FILTER[query.status],
        competitionKey: query.competition,
      }),
    ]);
    const nowIso = getNow().toISOString();
    const current = matches.filter(
      (match) => query.status !== "upcoming" || match.kickoffAt >= nowIso,
    );
    const ordered = query.status === "finished" ? [...current].reverse() : current;
    return jsonSuccess(
      {
        competitions,
        matches: ordered.slice(0, query.limit).map((match) => summariseMatch(match, competitions)),
      },
      {
        requestId,
        demoMode: getServerEnv().DEMO_MODE,
        provider: provider.id,
        simulated: provider.isSimulated,
        disclaimer: "Model probabilities for analysis only. Not betting advice.",
      },
    );
  },
  { rateLimit: RATE_LIMITS.read },
);
