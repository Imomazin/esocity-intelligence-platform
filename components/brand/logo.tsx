import { cn } from "@/lib/utils";

/**
 * Text-first Esocity brand mark (placeholder until a supplied logo asset exists).
 * The glyph is three ascending bars inside a rounded tile — a restrained nod to signals and
 * probability — rendered as inline SVG so it inherits theme colours.
 */
export function EsocityMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-7 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <rect x="8" y="17.5" width="4" height="6.5" rx="1.5" className="fill-primary-foreground/70" />
      <rect
        x="14"
        y="12.5"
        width="4"
        height="11.5"
        rx="1.5"
        className="fill-primary-foreground/85"
      />
      <rect x="20" y="8" width="4" height="16" rx="1.5" className="fill-primary-foreground" />
    </svg>
  );
}

export function EsocityWordmark({
  className,
  showTagline = false,
  size = "md",
}: {
  className?: string;
  showTagline?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <EsocityMark className={size === "lg" ? "size-9" : size === "sm" ? "size-6" : "size-7"} />
      <span className="flex flex-col leading-none">
        <span
          className={cn(
            "font-semibold tracking-[0.28em] text-foreground",
            size === "lg" ? "text-lg" : size === "sm" ? "text-xs" : "text-sm",
          )}
        >
          ESOCITY
        </span>
        {showTagline && (
          <span className="mt-1 text-[10px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Predictive Intelligence
          </span>
        )}
      </span>
    </span>
  );
}
