import {
  addDays,
  dayOfWeek,
  isBusinessDay,
  REGULAR_CLOSE_MINUTES,
  tradingDaysBetween,
  type TradingCalendar,
} from "@/lib/clock";

/**
 * NYSE trading calendar (regular session, cash equities).
 *
 * Full-day holidays follow NYSE Rule 7.2: a holiday on Saturday is observed on the Friday before
 * and a holiday on Sunday on the Monday after — except New Year's Day, which is NOT observed on
 * the preceding Friday (the market stays open on 31 December). Juneteenth is a holiday from
 * 2022. Early closes (13:00 New York) fall on 3 July and 24 December when those dates trade,
 * and on the day after Thanksgiving. Unscheduled closures (national days of mourning, weather)
 * cannot be derived from rules and are listed explicitly.
 *
 * Real market data providers use this calendar for session status, freshness and gap checks.
 * The synthetic demo market keeps its weekday calendar (lib/clock.ts → WEEKDAY_CALENDAR).
 */

export const EARLY_CLOSE_MINUTES = 13 * 60;

export interface ExchangeHoliday {
  date: string;
  name: string;
}

/** Unscheduled full-day NYSE closures since 2000. */
const SPECIAL_CLOSURES: readonly ExchangeHoliday[] = [
  { date: "2001-09-11", name: "September 11 attacks" },
  { date: "2001-09-12", name: "September 11 attacks" },
  { date: "2001-09-13", name: "September 11 attacks" },
  { date: "2001-09-14", name: "September 11 attacks" },
  { date: "2004-06-11", name: "National Day of Mourning (Ronald Reagan)" },
  { date: "2007-01-02", name: "National Day of Mourning (Gerald Ford)" },
  { date: "2012-10-29", name: "Hurricane Sandy" },
  { date: "2012-10-30", name: "Hurricane Sandy" },
  { date: "2018-12-05", name: "National Day of Mourning (George H. W. Bush)" },
  { date: "2025-01-09", name: "National Day of Mourning (Jimmy Carter)" },
];

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The n-th (1-based) given weekday (0 = Sunday) of a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = isoDate(year, month, 1);
  const offset = (weekday - dayOfWeek(first) + 7) % 7;
  return addDays(first, offset + (n - 1) * 7);
}

/** The last given weekday of a month. */
function lastWeekday(year: number, month: number, weekday: number): string {
  const nextMonthFirst = month === 12 ? isoDate(year + 1, 1, 1) : isoDate(year, month + 1, 1);
  const last = addDays(nextMonthFirst, -1);
  const offset = (dayOfWeek(last) - weekday + 7) % 7;
  return addDays(last, -offset);
}

/** Gregorian Easter Sunday (anonymous Gregorian / Meeus–Jones–Butcher algorithm). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

/** Saturday → preceding Friday, Sunday → following Monday. */
function observed(date: string): string {
  const day = dayOfWeek(date);
  if (day === 6) return addDays(date, -1);
  if (day === 0) return addDays(date, 1);
  return date;
}

function computeHolidays(year: number): ExchangeHoliday[] {
  const holidays: ExchangeHoliday[] = [];
  const newYear = isoDate(year, 1, 1);
  // Not observed on Friday 31 December when 1 January is a Saturday.
  if (dayOfWeek(newYear) !== 6) holidays.push({ date: observed(newYear), name: "New Year's Day" });
  holidays.push({ date: nthWeekday(year, 1, 1, 3), name: "Martin Luther King, Jr. Day" });
  holidays.push({ date: nthWeekday(year, 2, 1, 3), name: "Washington's Birthday" });
  holidays.push({ date: addDays(easterSunday(year), -2), name: "Good Friday" });
  holidays.push({ date: lastWeekday(year, 5, 1), name: "Memorial Day" });
  if (year >= 2022) {
    holidays.push({ date: observed(isoDate(year, 6, 19)), name: "Juneteenth" });
  }
  holidays.push({ date: observed(isoDate(year, 7, 4)), name: "Independence Day" });
  holidays.push({ date: nthWeekday(year, 9, 1, 1), name: "Labor Day" });
  holidays.push({ date: nthWeekday(year, 11, 4, 4), name: "Thanksgiving Day" });
  holidays.push({ date: observed(isoDate(year, 12, 25)), name: "Christmas Day" });
  holidays.push(...SPECIAL_CLOSURES.filter((closure) => closure.date.startsWith(`${year}-`)));
  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

const holidayCache = new Map<number, Map<string, string>>();
const earlyCloseCache = new Map<number, Set<string>>();

function holidayMap(year: number): Map<string, string> {
  let map = holidayCache.get(year);
  if (!map) {
    map = new Map(computeHolidays(year).map((holiday) => [holiday.date, holiday.name]));
    holidayCache.set(year, map);
  }
  return map;
}

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/** Full-day NYSE holidays and closures for a calendar year, ascending. */
export function nyseHolidays(year: number): ExchangeHoliday[] {
  return [...holidayMap(year)].map(([date, name]) => ({ date, name }));
}

export function nyseHolidayName(date: string): string | null {
  return holidayMap(yearOf(date)).get(date) ?? null;
}

export function isNyseTradingDay(date: string): boolean {
  return isBusinessDay(date) && !holidayMap(yearOf(date)).has(date);
}

/** Scheduled 13:00 early closes for a calendar year, ascending. */
export function nyseEarlyCloses(year: number): string[] {
  let set = earlyCloseCache.get(year);
  if (!set) {
    const candidates = [
      isoDate(year, 7, 3),
      addDays(nthWeekday(year, 11, 4, 4), 1),
      isoDate(year, 12, 24),
    ];
    set = new Set(candidates.filter((date) => isNyseTradingDay(date)));
    earlyCloseCache.set(year, set);
  }
  return [...set].sort();
}

export function isNyseEarlyClose(date: string): boolean {
  return nyseEarlyCloses(yearOf(date)).includes(date);
}

export const NYSE_CALENDAR: TradingCalendar = {
  id: "nyse",
  isTradingDay: isNyseTradingDay,
  closeMinutes: (date) => (isNyseEarlyClose(date) ? EARLY_CLOSE_MINUTES : REGULAR_CLOSE_MINUTES),
};

/**
 * Trading sessions strictly after `from` and up to and including `to` — e.g. how many sessions
 * a data set is behind. Zero when `to` is on or before `from`.
 */
export function tradingSessionsAfter(calendar: TradingCalendar, from: string, to: string): number {
  if (to <= from) return 0;
  return tradingDaysBetween(calendar, addDays(from, 1), to).length;
}
