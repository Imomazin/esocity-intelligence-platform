import { alignedCloses } from "@/lib/markets/correlation";
import type { PriceBar } from "@/lib/markets/types";
import {
  covariance,
  mean,
  normalQuantile,
  quantileSorted,
  round,
  stdDev,
  TRADING_DAYS_PER_YEAR,
  variance,
} from "@/lib/quant/stats";

/**
 * Portfolio risk analytics for the CURRENT paper holdings, from trailing daily prices
 * (model key: trade.portfolio-risk).
 *
 *   • Value at Risk and expected shortfall (95% / 99%) by historical simulation — every day (and
 *     overlapping 10-day window) of the lookback applied to today's position values — with a
 *     parametric normal estimate alongside for comparison.
 *   • Euler risk contributions: RC_i = w_i·(Σw)_i / σ_p, so each position's share of portfolio
 *     variance adds up to 100% and can be compared with its weight.
 *   • Diversification ratio Σ w_i σ_i / σ_p (1 = no diversification benefit).
 *   • Beta to the benchmark, market-shock scenarios (β × shock) and the worst historical windows
 *     for today's holdings, including the benchmark's own worst stretch.
 *
 * Cash is riskless here. Weights are shares of total account value, so figures are fractions of
 * the whole account. History cannot anticipate events that are not in it.
 */

export const PORTFOLIO_RISK_VERSION = "1.0.0";
export const RISK_LOOKBACK = 252;
const TEN_DAYS = 10;
const HISTOGRAM_BINS = 24;

export interface RiskHolding {
  symbol: string;
  marketValue: number;
}

export interface MoneyFraction {
  /** Fraction of total account value (a loss is positive). */
  fraction: number;
  amount: number;
}

export interface ValueAtRiskEstimate {
  key: string;
  confidence: number;
  horizonDays: number;
  historical: MoneyFraction;
  expectedShortfall: MoneyFraction;
  parametric: MoneyFraction;
}

export interface RiskContribution {
  symbol: string;
  weight: number;
  /** Annualised volatility of the asset over the lookback. */
  volatility: number;
  beta: number | null;
  /** Share of portfolio variance (sums to 1 across holdings). */
  riskShare: number;
}

export interface StressScenario {
  key: string;
  label: string;
  description: string;
  kind: "hypothetical" | "historical";
  start: string | null;
  end: string | null;
  portfolioReturn: number;
  pnl: number;
}

export interface ReturnHistogramBin {
  from: number;
  to: number;
  count: number;
}

export interface PortfolioRiskAnalytics {
  lookbackDays: number;
  start: string;
  end: string;
  totalValue: number;
  investedWeight: number;
  volatility: number;
  beta: number | null;
  correlationToBenchmark: number | null;
  diversificationRatio: number | null;
  valueAtRisk: ValueAtRiskEstimate[];
  contributions: RiskContribution[];
  scenarios: StressScenario[];
  /** Distribution of simulated one-day account returns. */
  histogram: ReturnHistogramBin[];
  benchmarkSymbol: string | null;
}

function money(fraction: number, totalValue: number): MoneyFraction {
  return { fraction: round(fraction, 6), amount: round(fraction * totalValue, 2) };
}

function simpleReturns(closes: readonly number[]): number[] {
  return closes.slice(1).map((close, i) => close / (closes[i] as number) - 1);
}

function histogram(values: readonly number[]): ReturnHistogramBin[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1e-6;
  const width = span / HISTOGRAM_BINS;
  const bins = Array.from({ length: HISTOGRAM_BINS }, (_, i) => ({
    from: round(min + i * width, 6),
    to: round(min + (i + 1) * width, 6),
    count: 0,
  }));
  for (const value of values) {
    const index = Math.min(HISTOGRAM_BINS - 1, Math.floor((value - min) / width));
    (bins[index] as ReturnHistogramBin).count += 1;
  }
  return bins;
}

/** Worst `length`-session window of a scenario-return function over the lookback. */
function worstWindow(
  dates: readonly string[],
  windowReturn: (from: number, to: number) => number,
  length: number,
): { start: string; end: string; value: number } | null {
  let worst: { start: string; end: string; value: number } | null = null;
  for (let i = 0; i + length < dates.length; i++) {
    const change = windowReturn(i, i + length);
    if (!worst || change < worst.value) {
      worst = { start: dates[i] as string, end: dates[i + length] as string, value: change };
    }
  }
  return worst;
}

export function analysePortfolioRisk(input: {
  holdings: readonly RiskHolding[];
  totalValue: number;
  barsBySymbol: ReadonlyMap<string, readonly PriceBar[]>;
  benchmarkSymbol?: string;
  lookbackDays?: number;
}): PortfolioRiskAnalytics | null {
  const { totalValue } = input;
  const holdings = input.holdings.filter(
    (holding) => holding.marketValue > 0 && input.barsBySymbol.has(holding.symbol),
  );
  if (holdings.length === 0 || !(totalValue > 0)) return null;
  const benchmarkBars =
    input.benchmarkSymbol !== undefined ? input.barsBySymbol.get(input.benchmarkSymbol) : undefined;
  const lookback = input.lookbackDays ?? RISK_LOOKBACK;

  const series = holdings.map((holding) => ({
    symbol: holding.symbol,
    bars: input.barsBySymbol.get(holding.symbol) as readonly PriceBar[],
  }));
  const benchmarkKey = "__benchmark__";
  if (benchmarkBars) series.push({ symbol: benchmarkKey, bars: benchmarkBars });
  const aligned = alignedCloses(series, lookback);
  if (!aligned) return null;
  const { dates, closes } = aligned;

  const weights = holdings.map((holding) => holding.marketValue / totalValue);
  const investedWeight = weights.reduce((total, weight) => total + weight, 0);
  const assetReturns = holdings.map((holding) =>
    simpleReturns(closes.get(holding.symbol) as number[]),
  );
  const benchmarkReturns = benchmarkBars
    ? simpleReturns(closes.get(benchmarkKey) as number[])
    : null;
  const days = assetReturns[0]?.length ?? 0;

  // Historical simulation: each past window's price moves applied to TODAY's position values
  // (cash earns nothing), expressed as a fraction of the whole account.
  const paths = holdings.map((holding) => closes.get(holding.symbol) as number[]);
  const windowReturn = (from: number, to: number) =>
    paths.reduce(
      (total, path, i) =>
        total + (weights[i] as number) * ((path[to] as number) / (path[from] as number) - 1),
      0,
    );
  const oneDay = dates.slice(1).map((_, t) => windowReturn(t, t + 1));
  const tenDay: number[] = [];
  for (let t = 0; t + TEN_DAYS < dates.length; t++) tenDay.push(windowReturn(t, t + TEN_DAYS));

  // Covariance of daily returns → volatility, Euler contributions, diversification.
  const covarianceMatrix = assetReturns.map((a) => assetReturns.map((b) => covariance(a, b)));
  const sigmaW = covarianceMatrix.map((row) =>
    row.reduce((total, value, j) => total + value * (weights[j] as number), 0),
  );
  const portfolioVariance = weights.reduce(
    (total, weight, i) => total + weight * (sigmaW[i] as number),
    0,
  );
  const portfolioSigma = Math.sqrt(Math.max(portfolioVariance, 0));
  const assetSigmas = assetReturns.map((returns) => stdDev(returns));
  const benchmarkVariance = benchmarkReturns ? variance(benchmarkReturns) : Number.NaN;
  const betas = assetReturns.map((returns) =>
    benchmarkReturns && benchmarkVariance > 0
      ? covariance(returns, benchmarkReturns) / benchmarkVariance
      : null,
  );
  const portfolioBeta = betas.every((beta) => beta !== null)
    ? betas.reduce((total, beta, i) => total + (beta as number) * (weights[i] as number), 0)
    : null;
  const accountBenchmarkCorrelation =
    benchmarkReturns && benchmarkVariance > 0 && portfolioSigma > 0
      ? covariance(oneDay, benchmarkReturns) / (stdDev(oneDay) * Math.sqrt(benchmarkVariance))
      : null;

  const contributions: RiskContribution[] = holdings
    .map((holding, i) => ({
      symbol: holding.symbol,
      weight: round(weights[i] as number, 6),
      volatility: round((assetSigmas[i] as number) * Math.sqrt(TRADING_DAYS_PER_YEAR), 4),
      beta: betas[i] === null ? null : round(betas[i] as number, 3),
      riskShare:
        portfolioVariance > 0
          ? round(((weights[i] as number) * (sigmaW[i] as number)) / portfolioVariance, 4)
          : 0,
    }))
    .sort((a, b) => b.riskShare - a.riskShare);

  const sortedOne = [...oneDay].sort((a, b) => a - b);
  const sortedTen = [...tenDay].sort((a, b) => a - b);
  const estimate = (confidence: number, horizonDays: number): ValueAtRiskEstimate => {
    const sorted = horizonDays === 1 ? sortedOne : sortedTen;
    const cut = quantileSorted(sorted, 1 - confidence);
    const tail = sorted.filter((value) => value <= cut);
    const z = normalQuantile(confidence);
    return {
      key: `${Math.round(confidence * 100)}-${horizonDays}d`,
      confidence,
      horizonDays,
      historical: money(Math.max(-cut, 0), totalValue),
      expectedShortfall: money(Math.max(-(tail.length ? mean(tail) : cut), 0), totalValue),
      parametric: money(z * portfolioSigma * Math.sqrt(horizonDays), totalValue),
    };
  };

  const scenarios: StressScenario[] = [];
  if (portfolioBeta !== null) {
    for (const shock of [-0.1, -0.2]) {
      const portfolioReturn = portfolioBeta * shock;
      scenarios.push({
        key: `market${Math.round(shock * 100)}`,
        label: `Benchmark falls ${Math.round(-shock * 100)}%`,
        description: `Each position moves by its beta × ${Math.round(shock * 100)}%; idiosyncratic moves ignored.`,
        kind: "hypothetical",
        start: null,
        end: null,
        portfolioReturn: round(portfolioReturn, 6),
        pnl: round(portfolioReturn * totalValue, 2),
      });
    }
  }
  for (const [length, label] of [
    [1, "Worst day"],
    [5, "Worst week"],
    [20, "Worst month"],
  ] as const) {
    const worst = worstWindow(dates, windowReturn, length);
    if (!worst) continue;
    scenarios.push({
      key: `worst-${length}`,
      label: `${label} in the last year`,
      description: `Today's holdings replayed over their worst ${length}-session stretch.`,
      kind: "historical",
      start: worst.start,
      end: worst.end,
      portfolioReturn: round(worst.value, 6),
      pnl: round(worst.value * totalValue, 2),
    });
  }
  if (benchmarkBars) {
    const benchmarkPath = closes.get(benchmarkKey) as number[];
    const worstBenchmark = worstWindow(
      dates,
      (from, to) => (benchmarkPath[to] as number) / (benchmarkPath[from] as number) - 1,
      20,
    );
    if (worstBenchmark) {
      const portfolioReturn = windowReturn(
        dates.indexOf(worstBenchmark.start),
        dates.indexOf(worstBenchmark.end),
      );
      scenarios.push({
        key: "benchmark-drawdown",
        label: `Replay of ${input.benchmarkSymbol}'s worst month`,
        description: `${input.benchmarkSymbol} moved ${(worstBenchmark.value * 100).toFixed(1)}% over this stretch.`,
        kind: "historical",
        start: worstBenchmark.start,
        end: worstBenchmark.end,
        portfolioReturn: round(portfolioReturn, 6),
        pnl: round(portfolioReturn * totalValue, 2),
      });
    }
  }

  const weightedSigma = weights.reduce(
    (total, weight, i) => total + weight * (assetSigmas[i] as number),
    0,
  );
  return {
    lookbackDays: days,
    start: dates[0] as string,
    end: dates[dates.length - 1] as string,
    totalValue: round(totalValue, 2),
    investedWeight: round(investedWeight, 6),
    volatility: round(portfolioSigma * Math.sqrt(TRADING_DAYS_PER_YEAR), 4),
    beta: portfolioBeta === null ? null : round(portfolioBeta, 3),
    correlationToBenchmark:
      accountBenchmarkCorrelation === null ? null : round(accountBenchmarkCorrelation, 3),
    diversificationRatio: portfolioSigma > 0 ? round(weightedSigma / portfolioSigma, 3) : null,
    valueAtRisk: [estimate(0.95, 1), estimate(0.99, 1), estimate(0.95, 10), estimate(0.99, 10)],
    contributions,
    scenarios,
    histogram: histogram(oneDay),
    benchmarkSymbol: benchmarkBars ? (input.benchmarkSymbol ?? null) : null,
  };
}
