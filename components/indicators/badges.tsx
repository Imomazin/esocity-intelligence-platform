import {
  Activity,
  ArrowLeftRight,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleX,
  Minus,
  OctagonAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";

import type { MarketRegime, TradeSignal } from "@/lib/markets/types";
import { RISK_LEVEL_LABELS, type RiskLevel } from "@/lib/risk-levels";
import { cn } from "@/lib/utils";

const BASE =
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap";

/** BUY / HOLD / SELL — label + icon + tint (never colour alone). */
export function SignalBadge({
  signal,
  className,
  size = "sm",
}: {
  signal: TradeSignal;
  className?: string;
  size?: "sm" | "lg";
}) {
  const Icon = signal === "BUY" ? TrendingUp : signal === "SELL" ? TrendingDown : Minus;
  return (
    <span
      className={cn(
        BASE,
        size === "lg" && "px-3 py-1 text-sm",
        signal === "BUY" && "border-positive/30 bg-positive/10 text-positive",
        signal === "SELL" && "border-negative/30 bg-negative/10 text-negative",
        signal === "HOLD" && "border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      <Icon className={size === "lg" ? "size-4" : "size-3.5"} aria-hidden />
      {signal}
    </span>
  );
}

const RISK_STYLES: Record<RiskLevel, { icon: typeof ShieldCheck; dot: string; tint: string }> = {
  LOW: {
    icon: ShieldCheck,
    dot: "text-status-good",
    tint: "border-status-good/30 bg-status-good/10",
  },
  MODERATE: {
    icon: CircleAlert,
    dot: "text-status-warning-text",
    tint: "border-status-warning/40 bg-status-warning/10",
  },
  HIGH: {
    icon: TriangleAlert,
    dot: "text-status-serious-text",
    tint: "border-status-serious/40 bg-status-serious/10",
  },
  VERY_HIGH: {
    icon: OctagonAlert,
    dot: "text-status-critical",
    tint: "border-status-critical/40 bg-status-critical/10",
  },
};

/** Four-level status scale for risk and uncertainty: icon + label + reserved status tint. */
export function RiskBadge({
  level,
  suffix = "risk",
  className,
}: {
  level: RiskLevel;
  suffix?: string;
  className?: string;
}) {
  const style = RISK_STYLES[level];
  const Icon = style.icon;
  return (
    <span className={cn(BASE, "font-medium text-foreground", style.tint, className)}>
      <Icon className={cn("size-3.5", style.dot)} aria-hidden />
      {RISK_LEVEL_LABELS[level]}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

const REGIME_ICONS: Record<MarketRegime, typeof TrendingUp> = {
  UPTREND: TrendingUp,
  DOWNTREND: TrendingDown,
  RANGE_BOUND: ArrowLeftRight,
  HIGH_VOLATILITY: Activity,
};

const REGIME_TEXT: Record<MarketRegime, string> = {
  UPTREND: "Uptrend",
  DOWNTREND: "Downtrend",
  RANGE_BOUND: "Range-bound",
  HIGH_VOLATILITY: "High volatility",
};

export function RegimeBadge({ regime, className }: { regime: MarketRegime; className?: string }) {
  const Icon = REGIME_ICONS[regime];
  return (
    <span
      className={cn(BASE, "border-border bg-background font-medium text-foreground", className)}
    >
      <Icon className="size-3.5 text-muted-foreground" aria-hidden />
      {REGIME_TEXT[regime]}
    </span>
  );
}

export type ServiceStatus = "up" | "down" | "degraded" | "not_configured" | "ok";

const SERVICE_STYLES: Record<
  ServiceStatus,
  { icon: typeof CircleCheck; label: string; className: string; iconClass: string }
> = {
  up: {
    icon: CircleCheck,
    label: "Operational",
    className: "border-status-good/30 bg-status-good/10",
    iconClass: "text-status-good",
  },
  ok: {
    icon: CircleCheck,
    label: "Operational",
    className: "border-status-good/30 bg-status-good/10",
    iconClass: "text-status-good",
  },
  degraded: {
    icon: CircleAlert,
    label: "Degraded",
    className: "border-status-warning/40 bg-status-warning/10",
    iconClass: "text-status-warning-text",
  },
  down: {
    icon: CircleX,
    label: "Unavailable",
    className: "border-status-critical/40 bg-status-critical/10",
    iconClass: "text-status-critical",
  },
  not_configured: {
    icon: CircleDot,
    label: "Not configured",
    className: "border-border bg-muted",
    iconClass: "text-muted-foreground",
  },
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: ServiceStatus;
  label?: string;
  className?: string;
}) {
  const style = SERVICE_STYLES[status];
  const Icon = style.icon;
  return (
    <span className={cn(BASE, "font-medium text-foreground", style.className, className)}>
      <Icon className={cn("size-3.5", style.iconClass)} aria-hidden />
      {label ?? style.label}
    </span>
  );
}
