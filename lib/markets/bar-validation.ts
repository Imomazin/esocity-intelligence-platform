import { tradingDaysBetween, type TradingCalendar } from "@/lib/clock";
import type { PriceBar } from "@/lib/markets/types";

/**
 * Data-quality gate for daily bars arriving from a licensed provider, applied BEFORE anything
 * is written to PostgreSQL:
 *
 *   • completed sessions only — no bar dated after the last completed session (no look-ahead,
 *     no partially formed "today" bar);
 *   • finite, positive prices; OHLC consistency (tiny adjustment-rounding violations are
 *     repaired, larger ones rejected); whole, non-negative volume;
 *   • prices rounded to the storage precision (numeric(18,6)) so re-fetched history compares
 *     exactly with what is stored;
 *   • unique ascending dates.
 *
 * Suspicious-but-plausible data (large one-day moves, missing sessions, bars on exchange
 * holidays) is kept and reported as warnings for the operator.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Relative OHLC inconsistency tolerated (and repaired) as split-adjustment rounding. */
const REPAIR_TOLERANCE = 0.005;
/** One-day move large enough to suggest an unadjusted split or a bad print. */
const EXTREME_MOVE = 0.4;
/** Relative price change that marks previously stored history as restated upstream. */
export const RESTATEMENT_TOLERANCE = 0.005;

export interface BarValidationResult {
  bars: PriceBar[];
  rejected: { date: string; reason: string }[];
  warnings: string[];
}

export function roundPrice(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function validDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function summariseDates(dates: readonly string[], max = 5): string {
  const shown = dates.slice(0, max).join(", ");
  return dates.length > max ? `${shown} and ${dates.length - max} more` : shown;
}

export function validateBars(
  input: readonly PriceBar[],
  options: { through: string; calendar: TradingCalendar },
): BarValidationResult {
  const rejected: BarValidationResult["rejected"] = [];
  const warnings: string[] = [];
  const byDate = new Map<string, PriceBar>();
  let repaired = 0;

  for (const raw of input) {
    if (!validDate(raw.date)) {
      rejected.push({ date: String(raw.date), reason: "invalid date" });
      continue;
    }
    // Sessions after the last completed one are not final yet — silently deferred.
    if (raw.date > options.through) continue;

    const prices = [raw.open, raw.high, raw.low, raw.close];
    if (!prices.every((value) => Number.isFinite(value) && value > 0)) {
      rejected.push({ date: raw.date, reason: "non-positive or non-finite price" });
      continue;
    }
    if (!Number.isFinite(raw.volume) || raw.volume < 0) {
      rejected.push({ date: raw.date, reason: "invalid volume" });
      continue;
    }

    const open = roundPrice(raw.open);
    let high = roundPrice(raw.high);
    let low = roundPrice(raw.low);
    const close = roundPrice(raw.close);
    const top = Math.max(open, close);
    const bottom = Math.min(open, close);
    if (high < top || low > bottom || low > high) {
      const violation = Math.max(
        high < top ? (top - high) / top : 0,
        low > bottom ? (low - bottom) / bottom : 0,
      );
      if (low > high || violation > REPAIR_TOLERANCE) {
        rejected.push({ date: raw.date, reason: "inconsistent OHLC" });
        continue;
      }
      high = Math.max(high, top);
      low = Math.min(low, bottom);
      repaired += 1;
    }

    byDate.set(raw.date, {
      date: raw.date,
      open,
      high,
      low,
      close,
      volume: Math.round(raw.volume),
    });
  }

  const bars = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  if (repaired > 0) {
    warnings.push(`${repaired} bar(s) had OHLC rounding inconsistencies and were repaired.`);
  }
  if (rejected.length > 0) {
    warnings.push(
      `${rejected.length} bar(s) rejected: ${rejected
        .slice(0, 3)
        .map((item) => `${item.date} (${item.reason})`)
        .join(", ")}${rejected.length > 3 ? ", …" : ""}.`,
    );
  }

  const nonTrading = bars.filter((bar) => !options.calendar.isTradingDay(bar.date));
  if (nonTrading.length > 0) {
    warnings.push(`Bars on non-trading days: ${summariseDates(nonTrading.map((b) => b.date))}.`);
  }

  const extreme: string[] = [];
  for (let i = 1; i < bars.length; i++) {
    const previous = bars[i - 1] as PriceBar;
    const current = bars[i] as PriceBar;
    if (Math.abs(current.close / previous.close - 1) > EXTREME_MOVE) extreme.push(current.date);
  }
  if (extreme.length > 0) {
    warnings.push(
      `One-day moves above ${EXTREME_MOVE * 100}% on ${summariseDates(extreme)} — check for unadjusted splits or bad prints.`,
    );
  }

  const missing = missingSessions(bars, options.calendar);
  if (missing.length > 0) {
    warnings.push(`Missing sessions: ${summariseDates(missing)}.`);
  }

  return { bars, rejected, warnings };
}

/** Trading sessions between the first and last bar that have no bar. */
export function missingSessions(bars: readonly PriceBar[], calendar: TradingCalendar): string[] {
  const first = bars[0]?.date;
  const last = bars[bars.length - 1]?.date;
  if (!first || !last) return [];
  const present = new Set(bars.map((bar) => bar.date));
  return tradingDaysBetween(calendar, first, last).filter((date) => !present.has(date));
}

function relativeChange(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);
}

/**
 * Dates where freshly fetched bars disagree with stored ones by more than the tolerance — the
 * signature of a split adjustment or an upstream correction. Volume is ignored (it is revised
 * routinely).
 */
export function restatedDates(
  stored: readonly PriceBar[],
  fetched: readonly PriceBar[],
  tolerance = RESTATEMENT_TOLERANCE,
): string[] {
  const storedByDate = new Map(stored.map((bar) => [bar.date, bar]));
  const changed: string[] = [];
  for (const bar of fetched) {
    const previous = storedByDate.get(bar.date);
    if (!previous) continue;
    const moved = (["open", "high", "low", "close"] as const).some(
      (field) => relativeChange(bar[field], previous[field]) > tolerance,
    );
    if (moved) changed.push(bar.date);
  }
  return changed;
}

/** Bars that are new or differ in any field from what is stored. */
export function changedBars(stored: readonly PriceBar[], fetched: readonly PriceBar[]): PriceBar[] {
  const storedByDate = new Map(stored.map((bar) => [bar.date, bar]));
  return fetched.filter((bar) => {
    const previous = storedByDate.get(bar.date);
    return (
      !previous ||
      previous.open !== bar.open ||
      previous.high !== bar.high ||
      previous.low !== bar.low ||
      previous.close !== bar.close ||
      previous.volume !== bar.volume
    );
  });
}
