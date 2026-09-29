import { ChartCandlestick } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/data/empty-state";
import { Button } from "@/components/ui/button";

export default function AssetNotFound() {
  return (
    <EmptyState
      icon={ChartCandlestick}
      className="mx-auto mt-10 max-w-lg"
      title="Unknown symbol"
      description="This symbol is not part of the configured universe, or it does not have enough history to analyse yet."
      action={
        <Button asChild>
          <Link href="/markets">Browse markets</Link>
        </Button>
      }
    />
  );
}
