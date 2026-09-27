import { KeyValueList } from "@/components/data/key-value-list";
import type { IndicatorSnapshot } from "@/features/markets/types";
import { formatNumber, formatPercent, formatSignedNumber, formatSignedPercent } from "@/lib/format";

function price(value: number | null): string {
  return value === null ? "—" : `$${formatNumber(value)}`;
}

export function IndicatorsPanel({ indicators }: { indicators: IndicatorSnapshot }) {
  const vsSma50 = indicators.sma50 ? indicators.close / indicators.sma50 - 1 : null;
  return (
    <KeyValueList
      columns={2}
      items={[
        { label: "Last close", value: price(indicators.close) },
        {
          label: "1-day return",
          value: indicators.return1d === null ? "—" : formatSignedPercent(indicators.return1d),
        },
        { label: "SMA 20", value: price(indicators.sma20) },
        {
          label: "SMA 50",
          value: price(indicators.sma50),
          hint: vsSma50 === null ? undefined : `Price ${formatSignedPercent(vsSma50, 1)} vs SMA 50`,
        },
        { label: "EMA 20", value: price(indicators.ema20) },
        { label: "RSI (14)", value: indicators.rsi14 === null ? "—" : indicators.rsi14.toFixed(1) },
        {
          label: "MACD (12, 26)",
          value: indicators.macd === null ? "—" : formatSignedNumber(indicators.macd, 3),
          hint:
            indicators.macdSignal === null
              ? undefined
              : `Signal ${formatSignedNumber(indicators.macdSignal, 3)}`,
        },
        {
          label: "Momentum 1M",
          value:
            indicators.momentum21 === null ? "—" : formatSignedPercent(indicators.momentum21, 1),
        },
        {
          label: "Momentum 3M",
          value:
            indicators.momentum63 === null ? "—" : formatSignedPercent(indicators.momentum63, 1),
        },
        {
          label: "Trend strength",
          value:
            indicators.trendStrength === null
              ? "—"
              : formatSignedNumber(indicators.trendStrength, 2),
          hint: "−1 … +1 (OLS slope ÷ vol × R²)",
        },
        {
          label: "Volatility 20D (ann.)",
          value: indicators.volatility20 === null ? "—" : formatPercent(indicators.volatility20, 1),
        },
        {
          label: "Volatility 63D (ann.)",
          value: indicators.volatility63 === null ? "—" : formatPercent(indicators.volatility63, 1),
        },
        {
          label: "Vol percentile (1Y)",
          value:
            indicators.volatilityPercentile === null
              ? "—"
              : formatPercent(indicators.volatilityPercentile, 0),
        },
        { label: "Drawdown from peak", value: formatPercent(indicators.drawdown, 1) },
      ]}
    />
  );
}
