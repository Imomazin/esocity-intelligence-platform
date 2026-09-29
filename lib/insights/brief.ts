import {
  formatCurrency,
  formatDate,
  formatPercent,
  formatProbability,
  formatSignedNumber,
  formatSignedPercent,
} from "@/lib/format";
import type { AssetForecast } from "@/lib/markets/forecast";
import type { RegimeStatus } from "@/lib/markets/regime-analysis";
import { REGIME_LABELS, type MarketRegime, type TradeSignal } from "@/lib/markets/types";
import type { SeasonProjection } from "@/lib/sports/season-simulation";
import type { PortfolioRiskAnalytics } from "@/lib/trade/risk-analytics";

/**
 * Intelligence brief: a short, ranked list of what changed and what matters across markets,
 * sport and the paper portfolio. Deterministic rules over analytics that are already computed —
 * every statement is traceable to a number shown elsewhere in the product, phrased as a
 * probability or a historical fact, never as a promise.
 */

export type InsightModule = "markets" | "sports" | "trade";
export type InsightSeverity = "info" | "notice" | "warning";

export interface Insight {
  id: string;
  module: InsightModule;
  kind:
    | "signal-change"
    | "regime-shift"
    | "unusual-move"
    | "volatility"
    | "probability"
    | "breadth"
    | "correlation"
    | "title-race"
    | "decisive-fixture"
    | "risk-concentration"
    | "value-at-risk"
    | "drawdown";
  severity: InsightSeverity;
  title: string;
  detail: string;
  href: string;
  /** Ranking weight in [0, 1]. */
  salience: number;
}

export interface BriefAsset {
  symbol: string;
  signal: TradeSignal;
  score: number;
  probabilityUp: number;
  changePercent: number;
  lastChange: { date: string; from: TradeSignal | null; to: TradeSignal } | null;
  regimeStatus: RegimeStatus | null;
  forecast: AssetForecast | null;
}

export interface BriefCompetition {
  key: string;
  name: string;
  projection: SeasonProjection;
  teamNames: Record<string, string>;
}

export interface BriefInputs {
  /** Latest completed market session (YYYY-MM-DD). */
  marketDate: string;
  now: Date;
  horizonDays: number;
  assets: readonly BriefAsset[];
  breadth: { aboveSma50: number; assets: number } | null;
  correlation: { averageCorrelation: number; independentDrivers: number; assets: number } | null;
  competitions: readonly BriefCompetition[];
  portfolio: {
    risk: PortfolioRiskAnalytics | null;
    currentDrawdown: number;
    largestPosition: { symbol: string; weight: number } | null;
  } | null;
}

const RECENT_SESSIONS_DAYS = 7;
const MODULE_CAP = 3;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function marketInsights(inputs: BriefInputs): Insight[] {
  const insights: Insight[] = [];
  const horizon = inputs.horizonDays;

  for (const asset of inputs.assets) {
    const href = `/markets/${asset.symbol}`;
    const change = asset.lastChange;
    if (change && daysBetween(change.date, inputs.marketDate) <= RECENT_SESSIONS_DAYS) {
      insights.push({
        id: `signal-${asset.symbol}-${change.date}`,
        module: "markets",
        kind: "signal-change",
        severity: "notice",
        title: `${asset.symbol} moved to ${change.to}`,
        detail: `Composite ${formatSignedNumber(asset.score, 2)} since ${formatDate(change.date)}${
          change.from ? ` (was ${change.from})` : ""
        }; calibrated P(up, ${horizon}d) ${formatProbability(asset.probabilityUp)}.`,
        href,
        salience: clamp01(0.6 + 0.3 * Math.abs(asset.score)),
      });
    }

    const regime = asset.regimeStatus;
    if (regime && regime.sessions <= 5) {
      const persistence =
        regime.persistence !== null
          ? ` Historically ${formatProbability(regime.persistence)} of such regimes were still in place ${horizon} sessions later.`
          : "";
      insights.push({
        id: `regime-${asset.symbol}-${regime.since}`,
        module: "markets",
        kind: "regime-shift",
        severity: regime.regime === "HIGH_VOLATILITY" ? "warning" : "notice",
        title: `${asset.symbol} entered a ${REGIME_LABELS[regime.regime as MarketRegime].toLowerCase()} regime`,
        detail: `Since ${formatDate(regime.since)}.${persistence}`,
        href,
        salience: regime.regime === "HIGH_VOLATILITY" ? 0.62 : 0.55,
      });
    }

    const forecast = asset.forecast;
    if (forecast && forecast.volatility.dailyNow > 0) {
      const z = Math.abs(asset.changePercent) / forecast.volatility.dailyNow;
      if (z >= 2.5) {
        insights.push({
          id: `move-${asset.symbol}-${inputs.marketDate}`,
          module: "markets",
          kind: "unusual-move",
          severity: z >= 3.5 ? "warning" : "notice",
          title: `${asset.symbol} moved ${formatSignedPercent(asset.changePercent, 1)} today`,
          detail: `About ${z.toFixed(1)}× its typical daily move (${formatPercent(forecast.volatility.dailyNow, 1)} one-day volatility).`,
          href,
          salience: clamp01(0.55 + 0.05 * (z - 2.5)),
        });
      }
      if (forecast.volatility.condition === "elevated") {
        insights.push({
          id: `vol-${asset.symbol}-${inputs.marketDate}`,
          module: "markets",
          kind: "volatility",
          severity: "notice",
          title: `${asset.symbol} volatility is elevated`,
          detail: `${formatPercent(forecast.volatility.annualisedNow, 0)} annualised against a one-year norm of ${formatPercent(forecast.volatility.annualisedLongRun, 0)}; the ${horizon}-day range widens accordingly.`,
          href,
          salience: 0.42,
        });
      }
    }
  }

  const ranked = [...inputs.assets].sort((a, b) => b.probabilityUp - a.probabilityUp);
  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];
  if (top && top.probabilityUp >= 0.6) {
    insights.push({
      id: `prob-high-${top.symbol}`,
      module: "markets",
      kind: "probability",
      severity: "info",
      title: `${top.symbol} has the highest calibrated P(up)`,
      detail: `${formatProbability(top.probabilityUp)} for a positive ${horizon}-day return — historically calibrated, not a guarantee.`,
      href: `/markets/${top.symbol}`,
      salience: 0.4,
    });
  }
  if (bottom && bottom !== top && bottom.probabilityUp <= 0.4) {
    insights.push({
      id: `prob-low-${bottom.symbol}`,
      module: "markets",
      kind: "probability",
      severity: "info",
      title: `${bottom.symbol} has the lowest calibrated P(up)`,
      detail: `${formatProbability(bottom.probabilityUp)} for a positive ${horizon}-day return.`,
      href: `/markets/${bottom.symbol}`,
      salience: 0.38,
    });
  }

  if (inputs.breadth && inputs.breadth.assets > 0) {
    const share = inputs.breadth.aboveSma50 / inputs.breadth.assets;
    if (share >= 0.75 || share <= 0.25) {
      insights.push({
        id: `breadth-${inputs.marketDate}`,
        module: "markets",
        kind: "breadth",
        severity: "info",
        title: share >= 0.75 ? "Broad participation" : "Weak breadth",
        detail: `${inputs.breadth.aboveSma50} of ${inputs.breadth.assets} tracked assets trade above their 50-day average.`,
        href: "/markets",
        salience: 0.35,
      });
    }
  }

  if (inputs.correlation && inputs.correlation.averageCorrelation >= 0.55) {
    insights.push({
      id: `correlation-${inputs.marketDate}`,
      module: "markets",
      kind: "correlation",
      severity: "notice",
      title: "Assets are moving together",
      detail: `Average 63-day correlation ${inputs.correlation.averageCorrelation.toFixed(2)} — the ${inputs.correlation.assets} assets behave like about ${inputs.correlation.independentDrivers.toFixed(1)} independent return drivers.`,
      href: "/markets",
      salience: 0.46,
    });
  }
  return insights;
}

function sportsInsights(inputs: BriefInputs): Insight[] {
  const insights: Insight[] = [];
  const soon = inputs.now.getTime() + 7 * 86_400_000;
  for (const competition of inputs.competitions) {
    const { projection } = competition;
    if (projection.remainingFixtures === 0) continue;
    const [first, second] = [...projection.teams].sort((a, b) => b.title - a.title);
    if (first && second && first.title < 0.75 && second.title >= 0.15) {
      insights.push({
        id: `title-${competition.key}`,
        module: "sports",
        kind: "title-race",
        severity: "info",
        title: `${competition.name}: title race is open`,
        detail: `${first.team.name} ${formatProbability(first.title)} vs ${second.team.name} ${formatProbability(second.title)} across ${projection.simulations.toLocaleString("en-US")} simulated seasons.`,
        href: "/sports",
        salience: 0.5,
      });
    } else if (first && first.title >= 0.9) {
      insights.push({
        id: `title-${competition.key}`,
        module: "sports",
        kind: "title-race",
        severity: "info",
        title: `${competition.name}: ${first.team.name} near the title`,
        detail: `Won the league in ${formatProbability(first.title)} of simulated seasons.`,
        href: "/sports",
        salience: 0.45,
      });
    }

    const decisive = projection.decisive.find(
      (fixture) => Date.parse(fixture.kickoffAt) <= soon && fixture.swing >= 0.1,
    );
    if (decisive) {
      const name = (key: string) => competition.teamNames[key] ?? key;
      const team = name(decisive.teamKey);
      insights.push({
        id: `decisive-${decisive.id}`,
        module: "sports",
        kind: "decisive-fixture",
        severity: "notice",
        title: `${name(decisive.homeKey)} v ${name(decisive.awayKey)} could swing the title race`,
        detail: `${team}'s title chance: ${formatProbability(decisive.ifHomeWin)} after a home win, ${formatProbability(decisive.ifDraw)} after a draw, ${formatProbability(decisive.ifAwayWin)} after an away win.`,
        href: `/sports/match/${decisive.id}`,
        salience: clamp01(0.5 + decisive.swing / 2),
      });
    }
  }
  return insights;
}

function portfolioInsights(inputs: BriefInputs): Insight[] {
  const portfolio = inputs.portfolio;
  if (!portfolio) return [];
  const insights: Insight[] = [];
  const risk = portfolio.risk;
  if (risk) {
    const outlier = [...risk.contributions].sort(
      (a, b) => b.riskShare - b.weight - (a.riskShare - a.weight),
    )[0];
    if (outlier && outlier.riskShare - outlier.weight >= 0.08) {
      insights.push({
        id: `risk-share-${outlier.symbol}`,
        module: "trade",
        kind: "risk-concentration",
        severity: "notice",
        title: `${outlier.symbol} drives more risk than its size suggests`,
        detail: `${formatPercent(outlier.weight, 0)} of the paper account but ${formatPercent(outlier.riskShare, 0)} of its volatility.`,
        href: "/trade",
        salience: 0.52,
      });
    }
    const var95 = risk.valueAtRisk.find((estimate) => estimate.key === "95-1d");
    if (var95 && var95.historical.fraction >= 0.015) {
      insights.push({
        id: "var-95-1d",
        module: "trade",
        kind: "value-at-risk",
        severity: var95.historical.fraction >= 0.03 ? "warning" : "info",
        title: `One-day 95% VaR: ${formatCurrency(var95.historical.amount, { maximumFractionDigits: 0 })}`,
        detail: `${formatPercent(var95.historical.fraction, 1)} of the paper account; on the worst 5% of days in the last year, losses averaged ${formatPercent(var95.expectedShortfall.fraction, 1)}.`,
        href: "/trade",
        salience: 0.4,
      });
    }
  }
  if (portfolio.currentDrawdown <= -0.08) {
    insights.push({
      id: "drawdown",
      module: "trade",
      kind: "drawdown",
      severity: portfolio.currentDrawdown <= -0.15 ? "warning" : "notice",
      title: `Paper account ${formatPercent(Math.abs(portfolio.currentDrawdown), 1)} below its peak`,
      detail: "Measured from the highest simulated account value.",
      href: "/trade",
      salience: 0.48,
    });
  }
  return insights;
}

/** Ranked insights: highest salience first, at most three per module. */
export function buildIntelligenceBrief(inputs: BriefInputs, limit = 6): Insight[] {
  const all = [...marketInsights(inputs), ...sportsInsights(inputs), ...portfolioInsights(inputs)];
  const ranked = all.sort((a, b) => b.salience - a.salience || a.id.localeCompare(b.id));
  const perModule = new Map<InsightModule, number>();
  const perSubject = new Set<string>();
  const selected: Insight[] = [];
  for (const insight of ranked) {
    const count = perModule.get(insight.module) ?? 0;
    // One headline per asset keeps the brief varied.
    const subject = insight.href.startsWith("/markets/") ? insight.href : insight.id;
    if (count >= MODULE_CAP || perSubject.has(subject)) continue;
    perModule.set(insight.module, count + 1);
    perSubject.add(subject);
    selected.push(insight);
    if (selected.length >= limit) break;
  }
  return selected;
}
