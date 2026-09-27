"use client";

import { Monitor, Moon, RotateCcw, Sun, Trash } from "lucide-react";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { SectionCard } from "@/components/data/section-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DEFAULT_WATCHLIST, useWatchlist } from "@/features/watchlist/components/watchlist";
import { useIsClient } from "@/lib/hooks/use-local-storage";
import {
  CHART_RANGES,
  DEFAULT_PREFERENCES,
  LOCAL_STORAGE_KEYS,
  usePreferences,
  type ChartRange,
} from "@/lib/hooks/use-preferences";

function SettingRow({
  title,
  description,
  htmlFor,
  children,
}: {
  title: string;
  description: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="text-sm font-medium">
            {title}
          </Label>
        ) : (
          <p className="text-sm font-medium">{title}</p>
        )}
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Client-side display preferences: theme, chart defaults, watchlist and local data. */
export function SettingsPanel() {
  const isClient = useIsClient();
  const { theme, setTheme } = useTheme();
  const [preferences, updatePreferences] = usePreferences();
  const [watchlist, setWatchlist] = useWatchlist();

  function clearLocalData() {
    try {
      for (const key of LOCAL_STORAGE_KEYS) window.localStorage.removeItem(key);
    } catch {
      // Storage unavailable — nothing persisted to clear.
    }
    updatePreferences(DEFAULT_PREFERENCES);
    setWatchlist(DEFAULT_WATCHLIST);
    setTheme("system");
    toast.success("Local data cleared", {
      description: "Preferences, watchlist and notification state were reset.",
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SectionCard title="Appearance" description="Stored in this browser only">
        <div className="divide-y">
          <SettingRow
            title="Colour theme"
            description="Dark and light themes are designed and contrast-checked independently."
          >
            <ToggleGroup
              type="single"
              value={isClient ? (theme ?? "system") : undefined}
              onValueChange={(value) => value && setTheme(value)}
              aria-label="Colour theme"
            >
              <ToggleGroupItem value="light" className="gap-1.5 px-3">
                <Sun aria-hidden /> Light
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" className="gap-1.5 px-3">
                <Moon aria-hidden /> Dark
              </ToggleGroupItem>
              <ToggleGroupItem value="system" className="gap-1.5 px-3">
                <Monitor aria-hidden /> System
              </ToggleGroupItem>
            </ToggleGroup>
          </SettingRow>
        </div>
      </SectionCard>

      <SectionCard title="Charts" description="Defaults for every chart on the platform">
        <div className="divide-y">
          <SettingRow
            title="Default price range"
            description="Initial range for asset price charts. Each chart can still be changed individually."
          >
            <ToggleGroup
              type="single"
              value={preferences.defaultChartRange}
              onValueChange={(value) =>
                value && updatePreferences({ defaultChartRange: value as ChartRange })
              }
              aria-label="Default price range"
            >
              {CHART_RANGES.map((range) => (
                <ToggleGroupItem key={range} value={range}>
                  {range}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </SettingRow>
          <SettingRow
            title="Open charts as tables"
            description="Show the data table instead of the chart by default — helpful with screen readers or for exact values."
            htmlFor="prefer-tables"
          >
            <Switch
              id="prefer-tables"
              checked={preferences.preferTables}
              onCheckedChange={(checked) => updatePreferences({ preferTables: checked })}
            />
          </SettingRow>
        </div>
      </SectionCard>

      <SectionCard
        title="Watchlist & local data"
        description="Nothing here leaves your browser"
        className="xl:col-span-2"
      >
        <div className="divide-y">
          <SettingRow
            title="Watchlist"
            description={
              isClient
                ? `${watchlist.length} tracked assets: ${watchlist.join(", ") || "none"}.`
                : "Tracked assets are stored in this browser."
            }
          >
            <Button variant="outline" size="sm" onClick={() => setWatchlist(DEFAULT_WATCHLIST)}>
              <RotateCcw /> Restore default watchlist
            </Button>
          </SettingRow>
          <SettingRow
            title="Clear local data"
            description="Removes saved preferences, watchlist and notification read-state from this browser, and resets the theme to System."
          >
            <Button variant="outline" size="sm" onClick={clearLocalData}>
              <Trash /> Clear local data
            </Button>
          </SettingRow>
        </div>
      </SectionCard>
    </div>
  );
}
