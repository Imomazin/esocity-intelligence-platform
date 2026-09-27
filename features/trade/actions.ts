"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { executePaperOrder, resetPaperAccount } from "@/features/trade/service";
import type { ActionResult } from "@/features/trade/types";
import { isAppError } from "@/lib/api/errors";
import { ensureWritableSession } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { checkRateLimit, clientIdentifier, RATE_LIMITS } from "@/lib/security/rate-limit";
import { orderRequestSchema } from "@/lib/trade/order-validation";
import type { PaperOrder } from "@/lib/trade/types";

/**
 * Server Actions for the paper-trading UI. Next.js enforces same-origin POSTs for Server
 * Actions; inputs are re-validated here — never trust the client.
 */

async function requestMeta() {
  const headerList = await headers();
  return {
    ipAddress: clientIdentifier(headerList),
    userAgent: headerList.get("user-agent") ?? undefined,
  };
}

function failure<T>(error: unknown, fallbackMessage: string): ActionResult<T> {
  if (isAppError(error) && error.status < 500) {
    return { ok: false, code: error.code, error: error.message };
  }
  logger.error("trade.action_failed", { error });
  return { ok: false, code: "INTERNAL_ERROR", error: fallbackMessage };
}

export async function placePaperOrderAction(
  input: unknown,
): Promise<ActionResult<{ order: PaperOrder }>> {
  const parsed = orderRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Please check the order details.",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    };
  }

  try {
    const meta = await requestMeta();
    const limit = await checkRateLimit(meta.ipAddress, RATE_LIMITS.orders);
    if (!limit.success) {
      return { ok: false, code: "RATE_LIMITED", error: "Too many orders. Please wait a moment." };
    }
    const session = await ensureWritableSession();
    const owner = { accountId: session.demoSessionId, ownerId: session.demoSessionId };
    const result = await executePaperOrder(owner, parsed.data, meta);
    revalidatePath("/trade");
    revalidatePath("/dashboard");
    return result.order.status === "FILLED"
      ? { ok: true, message: result.message, data: { order: result.order } }
      : {
          ok: false,
          code: result.order.rejectionReason ?? "ORDER_REJECTED",
          error: result.message,
          data: { order: result.order },
        };
  } catch (error) {
    return failure(error, "The paper order could not be processed. Please try again.");
  }
}

const resetSchema = z.enum(["demo", "cash"]);

export async function resetPaperAccountAction(
  mode: unknown,
): Promise<ActionResult<{ mode: "demo" | "cash" }>> {
  const parsed = resetSchema.safeParse(mode);
  if (!parsed.success) return { ok: false, code: "VALIDATION_ERROR", error: "Unknown reset mode." };
  try {
    const meta = await requestMeta();
    const session = await ensureWritableSession();
    await resetPaperAccount(
      { accountId: session.demoSessionId, ownerId: session.demoSessionId },
      parsed.data,
      meta,
    );
    revalidatePath("/trade");
    revalidatePath("/dashboard");
    return {
      ok: true,
      message:
        parsed.data === "demo"
          ? "Paper account restored to the demo portfolio."
          : "Paper account reset to $100,000 virtual cash.",
      data: { mode: parsed.data },
    };
  } catch (error) {
    return failure(error, "The paper account could not be reset. Please try again.");
  }
}
