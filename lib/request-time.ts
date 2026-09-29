import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";

/**
 * Licensed data lives in PostgreSQL and changes after every ingestion run, so pages that read it
 * render per request instead of being prerendered by `next build` — builds never need a database
 * (or ingested data) to succeed.
 *
 * Outside a Next.js request (the ingestion CLI, unit tests) there is nothing to opt out of.
 */
export async function renderAtRequestTime(): Promise<void> {
  try {
    await connection();
  } catch (error) {
    // Next.js signals "render this route dynamically" by throwing during prerendering: re-throw.
    unstable_rethrow(error);
  }
}

/**
 * Broad error handlers (fallback UI, allSettled) must not swallow Next.js control flow such as
 * the dynamic-rendering bailout, notFound() or redirect().
 */
export function rethrowControlFlow(error: unknown): void {
  unstable_rethrow(error);
}
