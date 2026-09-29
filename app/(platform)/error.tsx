"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

interface DataCheck {
  status?: string;
  error?: string;
  freshness?: string;
}

/**
 * Most failures of data-driven pages come from the data pipeline (nothing ingested yet, database
 * unreachable). Production error messages are hidden from the client, so ask /api/health — which
 * is public and secret-free — whether market or sports data is down and say so.
 */
function useDataIssues(error: Error): string[] {
  const [issues, setIssues] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { data?: { checks?: Record<string, DataCheck> } }) => {
        const checks = body.data?.checks ?? {};
        const found = (
          [
            ["Market data", checks.marketData],
            ["Sports data", checks.sportsData],
          ] as const
        )
          .filter(([, check]) => check?.status === "down")
          .map(
            ([label, check]) => `${label}: ${check?.error ?? check?.freshness ?? "unavailable"}`,
          );
        if (!cancelled) setIssues(found);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [error]);
  return issues;
}

export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const dataIssues = useDataIssues(error);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center"
      role="alert"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-status-serious/10">
        <TriangleAlert className="size-6 text-status-serious-text" aria-hidden />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold">This view could not be loaded</h1>
        <p className="text-sm text-muted-foreground">
          Something went wrong while computing this page. No data was changed. You can retry, or
          check system status in the Admin console.
        </p>
        {dataIssues.length > 0 && (
          <ul className="space-y-0.5 pt-1 text-sm">
            {dataIssues.map((issue) => (
              <li key={issue} className="font-medium">
                {issue}
              </li>
            ))}
          </ul>
        )}
        {error.digest && (
          <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
        )}
      </div>
      <div className="flex gap-2">
        <Button onClick={reset}>
          <RotateCcw /> Try again
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin">System status</Link>
        </Button>
      </div>
    </div>
  );
}
