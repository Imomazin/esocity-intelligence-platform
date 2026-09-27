import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { formatSignedCurrency, formatSignedPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Signed change indicator. Direction is encoded three ways — sign, arrow icon and colour — so
 * it never relies on colour alone.
 */
export function Delta({
  value,
  format = "percent",
  fractionDigits = 2,
  className,
  showIcon = true,
  invert = false,
}: {
  value: number | null | undefined;
  format?: "percent" | "currency" | "number";
  fractionDigits?: number;
  className?: string;
  showIcon?: boolean;
  /** Treat a decrease as good (e.g. drawdown shrinking). */
  invert?: boolean;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }
  const direction = value > 0 ? 1 : value < 0 ? -1 : 0;
  const good = invert ? direction < 0 : direction > 0;
  const bad = invert ? direction > 0 : direction < 0;
  const Icon = direction > 0 ? ArrowUpRight : direction < 0 ? ArrowDownRight : Minus;
  const text =
    format === "currency"
      ? formatSignedCurrency(value)
      : format === "number"
        ? `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(fractionDigits)}`
        : formatSignedPercent(value, fractionDigits);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-medium whitespace-nowrap",
        good && "text-positive",
        bad && "text-negative",
        !good && !bad && "text-muted-foreground",
        className,
      )}
    >
      {showIcon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      <span className="num">{text}</span>
    </span>
  );
}
