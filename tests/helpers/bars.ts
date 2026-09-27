import type { PriceBar } from "@/lib/markets/types";

/** Deterministic synthetic bars with alternating up/down phases (so strategies trade). */
export function makeBars(
  count: number,
  options: { start?: string; phase?: number } = {},
): PriceBar[] {
  const start = Date.parse(`${options.start ?? "2021-01-04"}T00:00:00Z`);
  const phase = options.phase ?? 60;
  const bars: PriceBar[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const drift = Math.floor(i / phase) % 2 === 0 ? 0.0015 : -0.001;
    const close = price * Math.exp(drift + 0.01 * Math.sin(i * 1.7));
    const open = price * (1 + 0.002 * Math.cos(i));
    bars.push({
      date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
      open,
      high: Math.max(open, close) * 1.004,
      low: Math.min(open, close) * 0.996,
      close,
      volume: 1_000_000 + 10_000 * (i % 7),
    });
    price = close;
  }
  return bars;
}
