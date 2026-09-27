import Link from "next/link";

import { EsocityWordmark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center"
    >
      <EsocityWordmark size="lg" />
      <div className="space-y-2">
        <p className="text-sm font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          404
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">We could not find that page</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The asset, match or page you requested does not exist in this environment.
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild>
          <Link href="/dashboard">Go to the platform</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/">Home</Link>
        </Button>
      </div>
    </main>
  );
}
