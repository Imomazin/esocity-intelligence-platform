/**
 * Display formatters. All date formatting is pinned to UTC so that server-rendered and
 * client-rendered output match (no hydration mismatches across time zones).
 */

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string, maximumFractionDigits: number): Intl.NumberFormat {
  const key = `${currency}:${maximumFractionDigits}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: Math.min(2, maximumFractionDigits),
      maximumFractionDigits,
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatCurrency(
  value: number,
  options: { currency?: string; maximumFractionDigits?: number } = {},
): string {
  const { currency = "USD", maximumFractionDigits = 2 } = options;
  if (!Number.isFinite(value)) return "—";
  return currencyFormatter(currency, maximumFractionDigits).format(value);
}

/** Currency with an explicit sign, e.g. "+$1,204.10" / "−$88.00". */
export function formatSignedCurrency(value: number, currency = "USD"): string {
  if (!Number.isFinite(value)) return "—";
  const formatted = formatCurrency(Math.abs(value), { currency });
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return compactFormatter.format(value);
}

export function formatCompactCurrency(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  return `${sign}$${compactFormatter.format(Math.abs(value))}`;
}

export function formatNumber(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

/** Format a ratio (0.1234) as a percentage ("12.3%"). */
export function formatPercent(ratio: number, fractionDigits = 1): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(fractionDigits)}%`;
}

/** Format a ratio with an explicit sign ("+1.2%" / "−0.4%"). */
export function formatSignedPercent(ratio: number, fractionDigits = 2): string {
  if (!Number.isFinite(ratio)) return "—";
  const magnitude = `${Math.abs(ratio * 100).toFixed(fractionDigits)}%`;
  if (ratio > 0) return `+${magnitude}`;
  if (ratio < 0) return `−${magnitude}`;
  return magnitude;
}

/** Probability as a whole-number percentage, e.g. 0.534 → "53%". */
export function formatProbability(probability: number, fractionDigits = 0): string {
  return formatPercent(probability, fractionDigits);
}

export function formatSignedNumber(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value).toFixed(fractionDigits);
  if (value > 0) return `+${magnitude}`;
  if (value < 0) return `−${magnitude}`;
  return magnitude;
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const shortDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

const weekdayFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

function toDate(value: string | Date): Date {
  return value instanceof Date
    ? value
    : new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
}

/** "25 Sept 2026" */
export function formatDate(value: string | Date): string {
  return dateFormatter.format(toDate(value));
}

/** "25 Sept" */
export function formatShortDate(value: string | Date): string {
  return shortDateFormatter.format(toDate(value));
}

/** "Sat 03 Oct" */
export function formatWeekdayDate(value: string | Date): string {
  return weekdayFormatter.format(toDate(value));
}

/** "15:00 UTC" */
export function formatTimeUtc(value: string | Date): string {
  return `${timeFormatter.format(toDate(value))} UTC`;
}

/** "25 Sept 2026, 15:00 UTC" */
export function formatDateTimeUtc(value: string | Date): string {
  return `${formatDate(value)}, ${formatTimeUtc(value)}`;
}

/** Relative time against an explicit reference ("3h ago", "in 2d"). Deterministic for SSR. */
export function formatRelativeTime(value: string | Date, reference: Date): string {
  const diffMs = toDate(value).getTime() - reference.getTime();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  let label: string;
  if (abs < minute) return "just now";
  if (abs < hour) label = `${Math.round(abs / minute)}m`;
  else if (abs < day) label = `${Math.round(abs / hour)}h`;
  else label = `${Math.round(abs / day)}d`;
  return diffMs < 0 ? `${label} ago` : `in ${label}`;
}
