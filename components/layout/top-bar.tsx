import { FlaskConical } from "lucide-react";
import Link from "next/link";

import { EsocityMark } from "@/components/brand/logo";
import { CommandMenu } from "@/components/layout/command-menu";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ShellData } from "@/features/platform/queries";

export function TopBar({
  shell,
  user,
  demoMode,
}: {
  shell: ShellData;
  user: { displayName: string; mode: "demo" | "authenticated" };
  demoMode: boolean;
}) {
  return (
    <header className="no-print sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:gap-3 lg:px-6">
      <MobileNav />
      <Link href="/dashboard" className="lg:hidden" aria-label="Esocity overview">
        <EsocityMark className="size-7" />
      </Link>
      <div className="min-w-0 flex-1">
        <CommandMenu items={shell.commands} />
      </div>
      {demoMode && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="hidden items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase md:inline-flex">
              <FlaskConical className="size-3" aria-hidden />
              Demo · synthetic data
            </span>
          </TooltipTrigger>
          <TooltipContent>
            All prices, fixtures and results are simulated. Paper trading only — no real orders.
          </TooltipContent>
        </Tooltip>
      )}
      <NotificationsMenu notifications={shell.notifications} />
      <ThemeToggle />
      <UserMenu displayName={user.displayName} mode={user.mode} />
    </header>
  );
}
