"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
