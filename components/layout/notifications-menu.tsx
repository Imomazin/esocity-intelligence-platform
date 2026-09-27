"use client";

import { Bell, BrainCircuit, ChartCandlestick, Info, Trophy } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PlatformNotification } from "@/features/platform/queries";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { cn } from "@/lib/utils";

const KIND_ICONS = {
  signal: ChartCandlestick,
  match: Trophy,
  model: BrainCircuit,
  system: Info,
} as const;

const EMPTY: string[] = [];

export function NotificationsMenu({ notifications }: { notifications: PlatformNotification[] }) {
  const [readIds, setReadIds] = useLocalStorage<string[]>("esocity:notifications:read", EMPTY);
  const unread = useMemo(
    () => notifications.filter((notification) => !readIds.includes(notification.id)),
    [notifications, readIds],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notifications${unread.length ? ` (${unread.length} unread)` : ""}`}
        >
          <Bell className="size-4" />
          {unread.length > 0 && (
            <span className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
              {unread.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            disabled={unread.length === 0}
            onClick={() => setReadIds(notifications.map((notification) => notification.id))}
          >
            Mark all read
          </Button>
        </div>
        {notifications.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            You are all caught up.
          </p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {notifications.map((notification) => {
              const Icon = KIND_ICONS[notification.kind];
              const isUnread = !readIds.includes(notification.id);
              return (
                <li key={notification.id}>
                  <Link
                    href={notification.href}
                    onClick={() =>
                      !readIds.includes(notification.id) &&
                      setReadIds([...readIds, notification.id])
                    }
                    className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border",
                        notification.severity === "warning" &&
                          "border-status-warning/50 bg-status-warning/10",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-3.5",
                          notification.severity === "warning"
                            ? "text-status-warning-text"
                            : "text-muted-foreground",
                        )}
                        aria-hidden
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "truncate text-sm",
                            isUnread ? "font-semibold" : "font-medium",
                          )}
                        >
                          {notification.title}
                        </span>
                        {isUnread && (
                          <span
                            className="size-1.5 shrink-0 rounded-full bg-primary"
                            aria-label="Unread"
                          />
                        )}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                        {notification.body}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
