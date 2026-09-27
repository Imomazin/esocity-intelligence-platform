import "server-only";

import { getPaperTradingViewForAccount } from "@/features/trade/service";
import type { PaperTradingView } from "@/features/trade/types";
import { getSession } from "@/lib/auth/session";

/** Paper trading view for the current visitor (preview until their first order). */
export async function getPaperTradingView(): Promise<PaperTradingView> {
  const session = await getSession();
  return getPaperTradingViewForAccount(session?.demoSessionId ?? null);
}
