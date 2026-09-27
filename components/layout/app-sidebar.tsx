"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { EsocityWordmark } from "@/components/brand/logo";
import { isNavItemActive, NAV_SECTIONS } from "@/components/layout/nav-config";
import { cn } from "@/lib/utils";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-6">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label} className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
            {section.label}
          </p>
          {section.items.map((item) => {
            const active = isNavItemActive(item, pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                  )}
                  aria-hidden
                />
                <span className="truncate">{item.title}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function AppSidebar() {
  return (
    <aside className="no-print sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <div className="flex h-14 items-center border-b border-sidebar-border px-5">
        <Link href="/dashboard" aria-label="Esocity overview" className="rounded-md">
          <EsocityWordmark showTagline size="sm" />
        </Link>
      </div>
      <div className="flex-1 scrollbar-thin overflow-y-auto px-3 py-5">
        <SidebarNav />
      </div>
      <div className="border-t border-sidebar-border px-5 py-4 text-[11px] leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground">Probabilistic intelligence</p>
        <p>Not guaranteed outcomes. Paper trading only.</p>
      </div>
    </aside>
  );
}
