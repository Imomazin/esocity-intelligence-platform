"use client";

import { useCallback } from "react";

import { useLocalStorage } from "@/lib/hooks/use-local-storage";

/**
 * Per-browser display preferences. Stored in localStorage (no server round-trip, no PII).
 * When real accounts are attached, persist these to the `user_preferences` table instead —
 * the shape is deliberately a flat, versionable object.
 */

export const CHART_RANGES = ["1M", "3M", "6M", "1Y", "2Y"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

export interface DisplayPreferences {
  version: 1;
  defaultChartRange: ChartRange;
  /** Open ChartFrame components in table view by default (useful with screen readers). */
  preferTables: boolean;
}

export const DEFAULT_PREFERENCES: DisplayPreferences = {
  version: 1,
  defaultChartRange: "6M",
  preferTables: false,
};

export const PREFERENCES_STORAGE_KEY = "esocity:preferences";

/** Every localStorage key the platform writes — used by "Clear local data" in Settings. */
export const LOCAL_STORAGE_KEYS = [
  PREFERENCES_STORAGE_KEY,
  "esocity:watchlist",
  "esocity:notifications:read",
] as const;

function normalise(value: Partial<DisplayPreferences> | null | undefined): DisplayPreferences {
  return {
    version: 1,
    defaultChartRange: CHART_RANGES.includes(value?.defaultChartRange as ChartRange)
      ? (value?.defaultChartRange as ChartRange)
      : DEFAULT_PREFERENCES.defaultChartRange,
    preferTables:
      typeof value?.preferTables === "boolean"
        ? value.preferTables
        : DEFAULT_PREFERENCES.preferTables,
  };
}

export function usePreferences(): [
  DisplayPreferences,
  (patch: Partial<DisplayPreferences>) => void,
] {
  const [stored, setStored] = useLocalStorage<Partial<DisplayPreferences>>(
    PREFERENCES_STORAGE_KEY,
    DEFAULT_PREFERENCES,
  );
  const preferences = normalise(stored);
  const update = useCallback(
    (patch: Partial<DisplayPreferences>) => setStored({ ...preferences, ...patch }),
    [preferences, setStored],
  );
  return [preferences, update];
}
