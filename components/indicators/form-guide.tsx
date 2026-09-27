import type { FormResult } from "@/lib/sports/types";
import { cn } from "@/lib/utils";

const LABELS: Record<FormResult, string> = { W: "Win", D: "Draw", L: "Loss" };

/** Recent results, oldest → most recent (right). Letters carry meaning; tints only reinforce. */
export function FormGuide({ form, className }: { form: FormResult[]; className?: string }) {
  if (form.length === 0) {
    return <span className="text-xs text-muted-foreground">No results yet</span>;
  }
  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      aria-label={`Form, oldest to most recent: ${form.map((result) => LABELS[result]).join(", ")}`}
    >
      {form.map((result, index) => (
        <span
          key={index}
          aria-hidden
          className={cn(
            "flex size-5 items-center justify-center rounded text-[10px] font-bold",
            result === "W" && "bg-positive/15 text-positive",
            result === "D" && "bg-muted text-muted-foreground",
            result === "L" && "bg-negative/15 text-negative",
            index === form.length - 1 && "ring-1 ring-foreground/20",
          )}
        >
          {result}
        </span>
      ))}
    </span>
  );
}
