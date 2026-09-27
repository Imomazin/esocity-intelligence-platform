"use client";

import { ChartCandlestick, Command as CommandIcon, FileText, Search, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import type { CommandItem as CommandEntry } from "@/features/platform/queries";

const GROUP_ICONS = {
  Pages: FileText,
  Assets: ChartCandlestick,
  Matches: Trophy,
} as const;

export function CommandMenu({ items }: { items: CommandEntry[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const groups = (["Pages", "Assets", "Matches"] as const).map((group) => ({
    group,
    entries: items.filter((item) => item.group === group),
  }));

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-9 w-full justify-start gap-2 text-muted-foreground sm:w-56 lg:w-72"
        aria-label="Search the platform (Ctrl+K)"
      >
        <Search className="size-4" aria-hidden />
        <span className="truncate">Search assets, matches, pages…</span>
        <kbd className="ml-auto hidden items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
          <CommandIcon className="size-3" aria-hidden />K
        </kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search Esocity"
        description="Jump to a page, asset or match"
      >
        <CommandInput placeholder="Type a symbol, team or page…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {groups.map(({ group, entries }, index) => {
            const Icon = GROUP_ICONS[group];
            return entries.length ? (
              <div key={group}>
                {index > 0 && <CommandSeparator />}
                <CommandGroup heading={group}>
                  {entries.map((entry) => (
                    <CommandItem
                      key={entry.id}
                      value={`${entry.label} ${entry.keywords ?? ""}`}
                      onSelect={() => {
                        setOpen(false);
                        router.push(entry.href);
                      }}
                    >
                      <Icon aria-hidden />
                      <span className="truncate">{entry.label}</span>
                      {entry.hint && <CommandShortcut>{entry.hint}</CommandShortcut>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </div>
            ) : null;
          })}
        </CommandList>
      </CommandDialog>
    </>
  );
}
