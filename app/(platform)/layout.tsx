import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { getDataSources } from "@/features/platform/data-sources";
import { getShellData } from "@/features/platform/queries";
import { buildDemoSession } from "@/lib/auth/demo";
import { getSession } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  // The platform shows per-session (and, in demo mode, synthetic) data — keep it out of indexes.
  robots: { index: false, follow: false },
};

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const env = getServerEnv();
  // Demo mode needs no cookie read here, which keeps market/sports pages statically cacheable.
  const session = env.DEMO_MODE ? buildDemoSession(null) : await getSession();
  if (!session) redirect("/?auth=required");

  const shell = await getShellData();

  return (
    <div className="flex min-h-dvh">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          shell={shell}
          user={{ displayName: session.user.displayName, mode: session.mode }}
          demoMode={env.DEMO_MODE}
          sources={getDataSources()}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
        >
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
        <footer className="no-print border-t px-4 py-4 text-[11px] leading-relaxed text-muted-foreground sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <p>
              <span className="font-medium text-foreground">{siteConfig.disclaimer}</span> Model
              outputs are research tools, not financial or betting advice. Paper trading only — no
              real orders are placed.
            </p>
            <p>
              © {new Date().getFullYear()} {siteConfig.name}
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
