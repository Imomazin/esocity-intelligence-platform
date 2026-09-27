import { KeyRound, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { KeyValueList } from "@/components/data/key-value-list";
import { SectionCard } from "@/components/data/section-card";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { SettingsPanel } from "@/features/settings/components/settings-panel";
import { ResetAccountButton } from "@/features/trade/components/reset-account";
import { DEMO_SESSION_COOKIE, DEMO_SESSION_MAX_AGE_SECONDS } from "@/lib/auth/demo";
import { getServerEnv } from "@/lib/env";
import { formatCurrency } from "@/lib/format";
import { PAPER_EXECUTION_CONFIG } from "@/lib/trade/execution";
import { DEMO_STARTING_CASH } from "@/lib/trade/demo-portfolio";

export const metadata: Metadata = {
  title: "Settings",
  description: "Display preferences, paper account controls, session and privacy information.",
};

// Reflects runtime configuration (storage backend, mode), so render per request.
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const env = getServerEnv();
  const cookieDays = Math.round(DEMO_SESSION_MAX_AGE_SECONDS / 86_400);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Esocity Core · System"
        title="Settings"
        description="Preferences apply to this browser. Paper-account controls act on your anonymous demo portfolio."
      />

      <SettingsPanel />

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Paper trading account"
          description="Simulated execution only — no broker connection exists"
          action={<ResetAccountButton />}
        >
          <KeyValueList
            items={[
              { label: "Starting virtual cash", value: formatCurrency(DEMO_STARTING_CASH) },
              { label: "Order types", value: "Market (BUY / SELL)" },
              {
                label: "Commission",
                value: `${PAPER_EXECUTION_CONFIG.commissionBps} bps · min ${formatCurrency(PAPER_EXECUTION_CONFIG.minimumCommission)}`,
              },
              { label: "Modelled slippage", value: `${PAPER_EXECUTION_CONFIG.slippageBps} bps` },
              { label: "Storage", value: env.DATABASE_URL ? "PostgreSQL" : "Demo key-value store" },
            ]}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Resetting replaces your order history with either the seeded demo portfolio or cash
            only. Every reset is written to the audit trail.{" "}
            <Link href="/trade" className="underline underline-offset-2 hover:text-foreground">
              Open paper trading
            </Link>
          </p>
        </SectionCard>

        <SectionCard
          title="Session & privacy"
          description={env.DEMO_MODE ? "Demo mode" : "Production mode"}
        >
          <div className="space-y-3 text-sm">
            <p className="flex gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-status-good" aria-hidden />
              <span>
                Demo mode has no accounts, passwords or personal data. Everyone uses the shared{" "}
                <strong>Demo Analyst</strong> identity; an anonymous random identifier keeps your
                paper portfolio separate from other visitors’.
              </span>
            </p>
            <KeyValueList
              items={[
                {
                  label: "Session cookie",
                  value: <code className="font-mono text-xs">{DEMO_SESSION_COOKIE}</code>,
                  hint: "httpOnly · SameSite=Lax · Secure in production",
                },
                { label: "Created", value: "On your first paper order or reset" },
                { label: "Expires", value: `${cookieDays} days` },
                { label: "Browser storage", value: "Theme, preferences, watchlist" },
                { label: "Tracking / analytics", value: "None" },
              ]}
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Accounts & authentication"
        description="Architected for Clerk or Auth.js — not enabled in this release"
      >
        <div className="flex flex-col gap-4 text-sm md:flex-row md:items-start md:justify-between">
          <p className="flex max-w-3xl gap-2 text-muted-foreground">
            <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Production mode (<code className="font-mono text-xs">DEMO_MODE=false</code>) requires
              an authentication provider. Session resolution is centralised in{" "}
              <code className="font-mono text-xs">lib/auth/session.ts</code>; attaching Clerk or
              Auth.js there enables real user accounts, per-user paper portfolios in PostgreSQL and
              role-based access to the admin console. Step-by-step instructions are in{" "}
              <code className="font-mono text-xs">docs/SECURITY.md</code>.
            </span>
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin">Review system configuration</Link>
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
