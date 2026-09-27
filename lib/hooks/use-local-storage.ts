"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Per-browser persisted state backed by localStorage, implemented with useSyncExternalStore so
 * server rendering and hydration stay consistent (the server snapshot is always the fallback).
 * Storage failures (private mode, blocked storage) degrade silently to the fallback value.
 */

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useLocalStorage<T>(key: string, fallback: T): [T, (value: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );

  const value = useMemo<T>(() => {
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }, [raw, fallback]);

  const setValue = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage unavailable — keep working with in-memory state for this render cycle.
      }
      for (const listener of listeners) listener();
    },
    [key],
  );

  return [value, setValue];
}

/** True after hydration on the client; false during SSR. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}
