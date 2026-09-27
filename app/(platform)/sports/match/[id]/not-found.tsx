import { Trophy } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/data/empty-state";
import { Button } from "@/components/ui/button";

export default function MatchNotFound() {
  return (
    <EmptyState
      icon={Trophy}
      className="mx-auto mt-10 max-w-lg"
      title="Match not found"
      description="Demo fixtures roll forward each week, so older links can expire. Browse the current fixture list instead."
      action={
        <Button asChild>
          <Link href="/sports/football">View fixtures</Link>
        </Button>
      }
    />
  );
}
