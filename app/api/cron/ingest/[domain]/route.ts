import { revalidatePath } from "next/cache";
import { z } from "zod";

import { apiRoute, parseParam } from "@/lib/api/handler";
import { jsonSuccess } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { runDataIngestion } from "@/lib/ingestion/service";
import { logger } from "@/lib/logger";
import { assertCronAuthorized } from "@/lib/security/cron";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
// Polygon's free tier allows five requests a minute: a full universe needs a few minutes.
export const maxDuration = 300;

/** Stop starting new symbols/leagues well before the platform's function time limit. */
const TIME_BUDGET_MS = 240_000;

const domainSchema = z.enum(["markets", "sports"]);

/**
 * GET /api/cron/ingest/:domain — scheduled ingestion of licensed data (vercel.json → crons).
 *
 *   200  run finished (succeeded / partial) or skipped (demo provider, run already in progress)
 *   401  missing or wrong `Authorization: Bearer <CRON_SECRET>`
 *   502  the run failed (provider or storage error — details in the report and run log)
 *   503  CRON_SECRET or the provider is not configured
 *
 * Demo-mode domains answer 200 "skipped" without authentication: nothing is done or revealed.
 */
export const GET = apiRoute<{ domain: string }>(
  async ({ request, params, requestId }) => {
    const domain = parseParam(params.domain, domainSchema, "domain");
    const env = getServerEnv();
    const provider = domain === "markets" ? env.MARKET_DATA_PROVIDER : env.SPORTS_DATA_PROVIDER;
    if (provider === "demo") {
      return jsonSuccess(
        { domain, status: "skipped", reason: "Synthetic demo data needs no ingestion." },
        { requestId },
      );
    }

    assertCronAuthorized(request.headers.get("authorization"), env.CRON_SECRET);
    const report = await runDataIngestion({
      domain,
      trigger: "schedule",
      timeBudgetMs: TIME_BUDGET_MS,
    });

    if (report.rowsWritten > 0) {
      try {
        // Regenerate ISR pages (markets, sports, dashboard…) from the new data.
        revalidatePath("/", "layout");
      } catch (error) {
        logger.warn("cron.revalidate_failed", { domain, error });
      }
    }
    return jsonSuccess(report, { requestId }, { status: report.status === "failed" ? 502 : 200 });
  },
  { rateLimit: RATE_LIMITS.cron },
);
