import {
  ArrowDown,
  Boxes,
  BrainCircuit,
  Database,
  Globe,
  Layers,
  Plug,
  Server,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface Node {
  icon: LucideIcon;
  title: string;
  detail: string;
  optional?: boolean;
}

const TIERS: { label: string; description: string; nodes: Node[]; highlight?: boolean }[] = [
  {
    label: "Experience",
    description: "Browser",
    nodes: [
      {
        icon: Globe,
        title: "Esocity web app",
        detail:
          "Server-rendered React · responsive · dark & light · accessible charts with table views",
      },
    ],
  },
  {
    label: "Esocity Web · Next.js on Vercel",
    description: "One deployable — runs fully on its own in demo mode",
    highlight: true,
    nodes: [
      {
        icon: Layers,
        title: "Server Components & Actions",
        detail: "Pages, paper orders, resets — validated server-side",
      },
      {
        icon: Server,
        title: "Typed API",
        detail: "/api/* route handlers · Zod · standard envelopes · rate limits",
      },
      {
        icon: BrainCircuit,
        title: "TypeScript engines",
        detail: "Signals, calibration, Poisson, risk, backtests",
      },
      {
        icon: Plug,
        title: "Provider adapters",
        detail: "Market data · sports data · paper broker",
      },
    ],
  },
  {
    label: "Data & services",
    description: "All optional in demo mode — the app degrades gracefully",
    nodes: [
      {
        icon: Database,
        title: "PostgreSQL",
        detail: "Drizzle ORM · 23 tables · append-only audit",
        optional: true,
      },
      { icon: Zap, title: "Redis (Upstash)", detail: "Shared cache & rate limits", optional: true },
      {
        icon: BrainCircuit,
        title: "Python ML API",
        detail: "FastAPI · scikit-learn · XGBoost · TS fallback",
        optional: true,
      },
      {
        icon: Boxes,
        title: "Data providers",
        detail: "Demo today · Polygon, SportMonks & more planned",
        optional: true,
      },
    ],
  },
];

/** Static, responsive platform architecture diagram (HTML, not an image, so it reads well at any size). */
export function ArchitectureDiagram() {
  return (
    <figure aria-label="Esocity platform architecture" className="space-y-3">
      {TIERS.map((tier, index) => (
        <div key={tier.label} className="space-y-3">
          <div
            className={cn(
              "rounded-xl border p-4 sm:p-5",
              tier.highlight ? "border-primary/40 bg-primary/5" : "bg-card",
            )}
          >
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-semibold tracking-[0.14em] uppercase">{tier.label}</p>
              <p className="text-xs text-muted-foreground">{tier.description}</p>
            </div>
            <div
              className={cn(
                "grid gap-3",
                tier.nodes.length > 1 && "sm:grid-cols-2",
                tier.nodes.length > 2 && "lg:grid-cols-4",
              )}
            >
              {tier.nodes.map((node) => (
                <div key={node.title} className="flex gap-3 rounded-lg border bg-background p-3">
                  <node.icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">
                      {node.title}
                      {node.optional && (
                        <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                          optional
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{node.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {index < TIERS.length - 1 && (
            <div className="flex justify-center" aria-hidden>
              <ArrowDown className="size-4 text-muted-foreground" />
            </div>
          )}
        </div>
      ))}
      <figcaption className="text-center text-xs text-muted-foreground">
        The web tier never depends on the Python service: every ML call has a TypeScript fallback.
      </figcaption>
    </figure>
  );
}
