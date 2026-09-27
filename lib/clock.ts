/**
 * Platform clock and trading calendar.
 *
 * Demo data is generated relative to "now" so the platform always looks current, while
 * `DEMO_AS_OF` pins the clock for reproducible screenshots, tests and demos. Engines never
 * call `new Date()` themselves — they receive `now` explicitly, which keeps them pure.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Current instant, honouring `DEMO_AS_OF` (YYYY-MM-DD → 12:00 UTC, or a full ISO timestamp). */
export function getNow(): Date {
  const pinned = process.env.DEMO_AS_OF?.trim();
  if (pinned) {
    const parsed = new Date(ISO_DATE.test(pinned) ? `${pinned}T12:00:00Z` : pinned);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function addDays(isoDate: string, days: number): string {
  const date = parseIsoDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(isoDate: string): number {
  return parseIsoDate(isoDate).getUTCDay();
}

/** Weekday check. Exchange holidays are intentionally ignored in the demo calendar. */
export function isBusinessDay(isoDate: string): boolean {
  const day = dayOfWeek(isoDate);
  return day !== 0 && day !== 6;
}

export function previousBusinessDay(isoDate: string): string {
  let cursor = addDays(isoDate, -1);
  while (!isBusinessDay(cursor)) cursor = addDays(cursor, -1);
  return cursor;
}

export function latestBusinessDayOnOrBefore(isoDate: string): string {
  let cursor = isoDate;
  while (!isBusinessDay(cursor)) cursor = addDays(cursor, -1);
  return cursor;
}

/** All business days in [start, end], inclusive. */
export function businessDaysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    if (isBusinessDay(cursor)) days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function daysBetween(start: string, end: string): number {
  return Math.round((parseIsoDate(end).getTime() - parseIsoDate(start).getTime()) / 86_400_000);
}

// ─── US equity session (NYSE / Nasdaq regular hours, 09:30–16:00 America/New_York) ──────────

export type MarketSessionStatus = "pre-market" | "open" | "closed";

export interface MarketSession {
  /** Trading date in New York local time. */
  sessionDate: string;
  status: MarketSessionStatus;
  isTradingDay: boolean;
  openAt: Date;
  closeAt: Date;
  /** Fraction of the regular session elapsed, clamped to [0, 1]. */
  elapsedFraction: number;
  /** Most recent trading date whose daily bar is complete. */
  lastCompletedDate: string;
}

const newYorkParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "shortOffset",
});

function newYorkLocal(now: Date): { date: string; offsetMinutes: number } {
  const parts = Object.fromEntries(
    newYorkParts.formatToParts(now).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  // timeZoneName looks like "GMT-4" or "GMT-5"
  const match = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(parts.timeZoneName ?? "");
  const hours = match ? Number(match[1]) : -5;
  const minutes = match?.[2] ? Number(match[2]) * Math.sign(hours) : 0;
  return { date, offsetMinutes: hours * 60 + minutes };
}

export function getUsMarketSession(now: Date): MarketSession {
  const { date, offsetMinutes } = newYorkLocal(now);
  // 09:30 and 16:00 New York expressed in UTC.
  const midnightUtc = parseIsoDate(date).getTime();
  const openAt = new Date(midnightUtc + (9 * 60 + 30 - offsetMinutes) * 60_000);
  const closeAt = new Date(midnightUtc + (16 * 60 - offsetMinutes) * 60_000);
  const isTradingDay = isBusinessDay(date);

  if (!isTradingDay) {
    return {
      sessionDate: date,
      status: "closed",
      isTradingDay,
      openAt,
      closeAt,
      elapsedFraction: 1,
      lastCompletedDate: latestBusinessDayOnOrBefore(date),
    };
  }

  const t = now.getTime();
  if (t < openAt.getTime()) {
    return {
      sessionDate: date,
      status: "pre-market",
      isTradingDay,
      openAt,
      closeAt,
      elapsedFraction: 0,
      lastCompletedDate: previousBusinessDay(date),
    };
  }
  if (t >= closeAt.getTime()) {
    return {
      sessionDate: date,
      status: "closed",
      isTradingDay,
      openAt,
      closeAt,
      elapsedFraction: 1,
      lastCompletedDate: date,
    };
  }
  return {
    sessionDate: date,
    status: "open",
    isTradingDay,
    openAt,
    closeAt,
    elapsedFraction: (t - openAt.getTime()) / (closeAt.getTime() - openAt.getTime()),
    lastCompletedDate: previousBusinessDay(date),
  };
}
