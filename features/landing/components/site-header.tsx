import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { EsocityWordmark } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";

const SECTIONS = [
  { href: "#modules", label: "Platform" },
  { href: "#markets", label: "Markets" },
  { href: "#sports", label: "Sports" },
  { href: "#methodology", label: "Methodology" },
  { href: "#architecture", label: "Architecture" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Esocity home" className="rounded-md">
          <EsocityWordmark />
        </Link>
        <nav aria-label="Sections" className="hidden items-center gap-1 lg:flex">
          {SECTIONS.map((section) => (
            <a
              key={section.href}
              href={section.href}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {section.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <Button size="sm" asChild>
            <Link href="/dashboard">
              Enter Demo Platform <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
