import {
  ArrowRight,
  BrainCircuit,
  CandlestickChart,
  ChartNoAxesColumn,
  CircleCheck,
  Database,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  Sigma,
  Trophy,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { EsocityWordmark } from "@/components/brand/logo";
import { Delta } from "@/components/data/delta";
import { RegimeBadge, RiskBadge, SignalBadge } from "@/components/indicators/badges";
import { InlineConfidence, ProbabilityMeter } from "@/components/indicators/meters";
import { OutcomeBar } from "@/components/indicators/outcome-bar";
import { Button } from "@/components/ui/button";
import { ArchitectureDiagram } from "@/features/landing/components/architecture-diagram";
import { AuthNotice } from "@/features/landing/components/auth-notice";
import { SiteHeader } from "@/features/landing/components/site-header";
import { getLandingPreview } from "@/features/landing/queries";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatProbability,
  formatSignedNumber,
  formatWeekdayDate,
} from "@/lib/format";
import { RISK_LEVEL_LABELS, RISK_LEVELS, type RiskLevel } from "@/lib/risk-levels";
import { siteConfig } from "@/lib/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Engine previews are deterministic per market day; refresh hourly.
export const revalidate = 3600;

// ─── Small building blocks ──────────────────────────────────────────────────────────────────

function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  className,
}: {
  id: string;
  eyebrow: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("scroll-mt-20 py-16 sm:py-24", className)}
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="mb-10 max-w-3xl space-y-3">
          <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
            {eyebrow}
          </p>
          <h2
            id={`${id}-title`}
            className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
          >
            {title}
          </h2>
          {intro && <p className="text-base leading-relaxed text-muted-foreground">{intro}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

function CheckList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-3 text-sm leading-relaxed">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function PreviewPanel({
  title,
  meta,
  children,
  className,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border bg-card p-4 shadow-sm sm:p-5", className)}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {title}
        </p>
        {meta && <p className="text-[11px] text-muted-foreground">{meta}</p>}
      </div>
      {children}
    </div>
  );
}

const MODULES: {
  icon: LucideIcon;
  name: string;
  href: string;
  summary: string;
  points: string[];
}[] = [
  {
    icon: LayoutDashboard,
    name: "Esocity Core",
    href: "/dashboard",
    summary: "The shared platform every module plugs into.",
    points: [
      "Unified overview dashboard",
      "Watchlist, reports & model lab",
      "Admin console with audit trail",
    ],
  },
  {
    icon: CandlestickChart,
    name: "Esocity Markets",
    href: "/markets",
    summary: "Explainable signals for equities and ETFs.",
    points: ["Causal technical indicators", "Regime detection", "Calibrated BUY / HOLD / SELL"],
  },
  {
    icon: Trophy,
    name: "Esocity Sports",
    href: "/sports",
    summary: "Full probability distributions for football.",
    points: [
      "Poisson / Dixon–Coles model",
      "Scoreline matrix to 6–6",
      "1X2, goals markets & uncertainty",
    ],
  },
  {
    icon: Wallet,
    name: "Esocity Trade",
    href: "/trade",
    summary: "Paper trading with a risk-first portfolio view.",
    points: [
      "Simulated fills with fees & slippage",
      "P&L, exposure & concentration",
      "Transparent portfolio risk score",
    ],
  },
];

const METHOD_STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Database,
    title: "Data",
    body: "Provider adapters normalise prices and fixtures into one schema. Demo data is synthetic and labelled as such everywhere.",
  },
  {
    icon: ChartNoAxesColumn,
    title: "Features",
    body: "Every feature is causal — computed only from information available on that date. No look-ahead, by construction and by test.",
  },
  {
    icon: Sigma,
    title: "Models",
    body: "Transparent scoring and classical statistics first: a weighted composite signal and a Poisson / Dixon–Coles goals model.",
  },
  {
    icon: Gauge,
    title: "Calibration",
    body: "Scores are mapped to probabilities with walk-forward logistic calibration, refitted quarterly on past data only.",
  },
  {
    icon: FlaskConical,
    title: "Evaluation",
    body: "Brier score, log loss, hit rates and reliability curves are measured out of sample and published in the Model Lab.",
  },
  {
    icon: BrainCircuit,
    title: "Presentation",
    body: "Outputs arrive as probabilities with confidence and uncertainty grades — and the factors behind them — never as certainties.",
  },
];

const RISK_COPY: Record<RiskLevel, string> = {
  LOW: "Score 0–24. Diversified, contained volatility and drawdown.",
  MODERATE: "Score 25–49. Typical equity risk; one factor may be elevated.",
  HIGH: "Score 50–74. Concentration, volatility or drawdown need attention.",
  VERY_HIGH: "Score 75–100. Several factors elevated at once — review exposure.",
};

// ─── Page ───────────────────────────────────────────────────────────────────────────────────

export default async function LandingPage() {
  const preview = await getLandingPreview();
  const {
    featuredAsset: asset,
    featuredMatch: match,
    marketEvaluation,
    sportsEvaluation,
    paper,
  } = preview;
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader />

      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        {/* ── Hero ─────────────────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-b">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)] [background-size:48px_48px] opacity-40"
          />
          <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-4 pt-14 pb-16 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pb-24">
            <div className="space-y-7">
              <Suspense fallback={null}>
                <AuthNotice />
              </Suspense>
              <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                <span className="font-semibold tracking-[0.22em] text-foreground">ESOCITY</span>
                <span aria-hidden>·</span>
                Markets · Sports · Trade
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.4rem] lg:leading-[1.05]">
                Predictive Intelligence for Markets &amp; Sport
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
                Turn complex market and sporting data into probabilities, signals and decision
                intelligence.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" asChild>
                  <Link href="/dashboard">
                    Enter Demo Platform <ArrowRight />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <a href="#methodology">How the models work</a>
                </Button>
              </div>
              <div className="space-y-1.5 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="size-4 text-primary" aria-hidden />
                  {siteConfig.disclaimer}
                </p>
                <p className="text-xs text-muted-foreground">
                  No sign-up · synthetic demo data · paper trading only — no real money, no live
                  orders.
                </p>
              </div>
            </div>

            <div className="space-y-3" aria-label="Live output from the demo engines">
              <p className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-status-good" aria-hidden />
                  Live engine output
                </span>
                <span>Synthetic data · as of {formatDate(preview.asOf)}</span>
              </p>
              {asset && (
                <PreviewPanel title="Markets signal" meta={`${asset.name}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-2xl font-semibold tracking-tight">{asset.symbol}</p>
                      <p className="num text-sm">
                        {formatCurrency(asset.price)}{" "}
                        <Delta value={asset.changePercent} className="text-xs" />
                      </p>
                    </div>
                    <SignalBadge signal={asset.signal} size="lg" />
                  </div>
                  <ProbabilityMeter
                    className="mt-4"
                    label="Probability of a higher close in 20 trading days"
                    value={asset.probabilityUp}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      Confidence <InlineConfidence value={asset.confidence} />
                    </span>
                    <RegimeBadge regime={asset.regime} />
                    <RiskBadge level={asset.riskLevel} />
                  </div>
                </PreviewPanel>
              )}
              <div className="grid gap-3 sm:grid-cols-[1.35fr_1fr]">
                {match && (
                  <PreviewPanel title="Match model" meta={match.competition.shortName}>
                    <p className="text-sm font-semibold">
                      {match.home.shortName}{" "}
                      <span className="font-normal text-muted-foreground">v</span>{" "}
                      {match.away.shortName}
                    </p>
                    <p className="mb-3 text-[11px] text-muted-foreground">
                      {formatWeekdayDate(match.kickoffAt)}
                    </p>
                    <OutcomeBar
                      home={match.prediction.home}
                      draw={match.prediction.draw}
                      away={match.prediction.away}
                      homeLabel={match.home.code}
                      awayLabel={match.away.code}
                    />
                    <p className="num mt-3 text-[11px] text-muted-foreground">
                      xG {formatNumber(match.prediction.lambdaHome, 2)} –{" "}
                      {formatNumber(match.prediction.lambdaAway, 2)} · Over 2.5{" "}
                      {formatProbability(match.prediction.over25)}
                    </p>
                  </PreviewPanel>
                )}
                <PreviewPanel title="Paper portfolio">
                  <p className="num text-xl font-semibold tracking-tight">
                    {formatCurrency(paper.summary.totalValue, { maximumFractionDigits: 0 })}
                  </p>
                  <Delta value={paper.summary.totalReturn} className="text-xs" />
                  <div className="mt-3">
                    <RiskBadge level={paper.risk.level} />
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">Virtual cash only</p>
                </PreviewPanel>
              </div>
            </div>
          </div>
        </section>

        {/* ── Product modules ──────────────────────────────────────────────────────────── */}
        <Section
          id="modules"
          eyebrow="One platform"
          title="Four modules, one intelligence layer"
          intro="Markets, sport and trading share the same design system, data layer, evaluation standards and audit trail — so an insight in one module reads the same way in every other."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map((module) => (
              <Link
                key={module.name}
                href={module.href}
                className="group flex flex-col gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-primary/50"
              >
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <module.icon className="size-5" aria-hidden />
                </span>
                <div className="space-y-1">
                  <p className="font-semibold">{module.name}</p>
                  <p className="text-sm text-muted-foreground">{module.summary}</p>
                </div>
                <ul className="space-y-1.5 text-sm">
                  {module.points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
                      {point}
                    </li>
                  ))}
                </ul>
                <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Open module{" "}
                  <ArrowRight
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
              </Link>
            ))}
          </div>
        </Section>

        {/* ── Markets intelligence ─────────────────────────────────────────────────────── */}
        <Section
          id="markets"
          eyebrow="Esocity Markets"
          title="Signals you can audit, not black boxes"
          intro="Every asset is scored from causal indicators and a regime classifier. The composite score, its weights and the calibrated probability behind each BUY, HOLD or SELL are shown on the asset page."
          className="border-t bg-muted/30"
        >
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <CheckList
              items={[
                "Returns, SMA 20/50, EMA, RSI, MACD, momentum, rolling volatility, trend strength and drawdown — all computed without look-ahead.",
                "Regime classification: uptrend, downtrend, range-bound or high volatility, with the thresholds published.",
                "A composite signal with visible weights, plus a walk-forward calibrated probability of a higher close over 20 trading days.",
                <>
                  Provider-agnostic: synthetic demo data today; Polygon, Twelve Data, Alpha Vantage,
                  FMP and enterprise feeds slot in behind one{" "}
                  <code className="font-mono text-xs">MarketDataProvider</code> interface.
                </>,
              ]}
            />
            <PreviewPanel
              title="Highest-conviction signals"
              meta={`Through ${formatDate(preview.asOf)}`}
            >
              <ul className="divide-y">
                {preview.assets.map((item) => (
                  <li
                    key={item.symbol}
                    className="grid grid-cols-[3.5rem_auto_1fr] items-center gap-3 py-2.5 text-sm sm:grid-cols-[3.5rem_auto_1fr_auto]"
                  >
                    <span className="font-semibold">{item.symbol}</span>
                    <SignalBadge signal={item.signal} />
                    <span className="flex items-center justify-end gap-2 text-xs text-muted-foreground sm:justify-start">
                      P(up){" "}
                      <span className="num font-medium text-foreground">
                        {formatProbability(item.probabilityUp)}
                      </span>
                    </span>
                    <RegimeBadge regime={item.regime} className="hidden sm:inline-flex" />
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                {siteConfig.financialDisclaimer}
              </p>
            </PreviewPanel>
          </div>
        </Section>

        {/* ── Sports intelligence ──────────────────────────────────────────────────────── */}
        <Section
          id="sports"
          eyebrow="Esocity Sports"
          title="Full distributions, not single picks"
          intro="The football model estimates expected goals for each side and derives the entire scoreline distribution — so every market, from the result to both teams scoring, comes from one coherent set of probabilities."
        >
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            {match ? (
              <PreviewPanel
                title={match.competition.name}
                meta={formatWeekdayDate(match.kickoffAt)}
                className="lg:order-first"
              >
                <div className="mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
                  <div>
                    <p className="font-semibold">{match.home.name}</p>
                    <p className="num text-xs text-muted-foreground">
                      λ {formatNumber(match.prediction.lambdaHome, 2)}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">v</span>
                  <div>
                    <p className="font-semibold">{match.away.name}</p>
                    <p className="num text-xs text-muted-foreground">
                      λ {formatNumber(match.prediction.lambdaAway, 2)}
                    </p>
                  </div>
                </div>
                <OutcomeBar
                  home={match.prediction.home}
                  draw={match.prediction.draw}
                  away={match.prediction.away}
                  homeLabel={match.home.shortName}
                  awayLabel={match.away.shortName}
                />
                <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
                  <ProbabilityMeter label="Over 2.5 goals" value={match.prediction.over25} />
                  <ProbabilityMeter label="Both teams score" value={match.prediction.btts} />
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  {match.prediction.topScoreline && (
                    <span>
                      Most likely score{" "}
                      <span className="num font-semibold text-foreground">
                        {match.prediction.topScoreline.home}–{match.prediction.topScoreline.away}
                      </span>{" "}
                      ({formatProbability(match.prediction.topScoreline.probability, 1)})
                    </span>
                  )}
                  <RiskBadge level={match.prediction.uncertainty} suffix="uncertainty" />
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Fictional clubs · synthetic season · {siteConfig.sportsDisclaimer}
                </p>
              </PreviewPanel>
            ) : (
              <div />
            )}
            <CheckList
              items={[
                "Expected goals (λ) from attack and defence ratings, home advantage, form, rest and availability — every adjustment itemised.",
                "A full 0–0 to 6–6 scoreline matrix with the Dixon–Coles low-score correction, renormalised so probabilities sum to exactly one.",
                "Home / draw / away, over/under 1.5, 2.5 and 3.5 goals, both teams to score, clean sheets and the most likely scorelines.",
                "A confidence score and an explicit uncertainty grade on every fixture — close contests are flagged, not hidden.",
              ]}
            />
          </div>
        </Section>

        {/* ── Paper trading ────────────────────────────────────────────────────────────── */}
        <Section
          id="trade"
          eyebrow="Esocity Trade"
          title="Practise execution without risking capital"
          intro="A paper-trading simulator for testing ideas against the platform's signals. There is no broker connection: live execution is disabled by design in this phase."
          className="border-t bg-muted/30"
        >
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <CheckList
              items={[
                "$100,000 of virtual cash and market orders filled at simulated quotes.",
                "5 bps commission (minimum $1) and 5 bps slippage modelled on every fill.",
                "Server-side validation for insufficient cash, insufficient holdings, invalid quantities and unknown symbols.",
                "Open and closed positions, realised and unrealised P&L, exposure, allocation and concentration.",
                "An event-sourced ledger — every order and rejection is written to the audit trail.",
              ]}
            />
            <PreviewPanel title="Demo portfolio" meta="Virtual cash only">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Total value</dt>
                  <dd className="num text-lg font-semibold">
                    {formatCurrency(paper.summary.totalValue)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Total return</dt>
                  <dd className="text-lg font-semibold">
                    <Delta value={paper.summary.totalReturn} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Open positions</dt>
                  <dd className="num font-medium">{paper.positions.length}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Gross exposure</dt>
                  <dd className="num font-medium">
                    {formatPercent(paper.summary.grossExposure, 1)}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 space-y-2 border-t pt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">Portfolio risk score</p>
                  <RiskBadge level={paper.risk.level} />
                </div>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {paper.risk.factors.map((factor) => (
                    <li key={factor.key} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{factor.label}</span>
                      <span className="num font-medium">
                        {formatNumber(factor.points, 0)}/{factor.maxPoints}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </PreviewPanel>
          </div>
        </Section>

        {/* ── Methodology ──────────────────────────────────────────────────────────────── */}
        <Section
          id="methodology"
          eyebrow="AI & model methodology"
          title="Calibration over conviction"
          intro="A probability is only useful if it means what it says. Esocity's pipeline is built to measure that — and to show you when a model falls short."
        >
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {METHOD_STEPS.map((step, index) => (
              <li key={step.title} className="rounded-xl border bg-card p-5">
                <div className="mb-3 flex items-center gap-3">
                  <span className="num flex size-7 items-center justify-center rounded-full border text-xs font-semibold">
                    {index + 1}
                  </span>
                  <step.icon className="size-4 text-primary" aria-hidden />
                  <p className="font-semibold">{step.title}</p>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-6 grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Markets · directional hit rate</p>
              <p className="num text-2xl font-semibold">
                {marketEvaluation.directionalHitRate === null
                  ? "—"
                  : formatPercent(marketEvaluation.directionalHitRate, 1)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {marketEvaluation.directionalCalls.toLocaleString("en-US")} walk-forward calls
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Markets · Brier skill vs base rate</p>
              <p className="num text-2xl font-semibold">
                {marketEvaluation.brierSkillScore === null
                  ? "—"
                  : `${formatSignedNumber(marketEvaluation.brierSkillScore * 100, 1)}%`}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Modest by design — honest calibration
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Sports · 1X2 accuracy</p>
              <p className="num text-2xl font-semibold">
                {sportsEvaluation.accuracy === null
                  ? "—"
                  : formatPercent(sportsEvaluation.accuracy, 1)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {sportsEvaluation.matches} finished matches, pre-match inputs only
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Sports · Brier skill vs base rates</p>
              <p className="num text-2xl font-semibold">
                {sportsEvaluation.brierSkillScore === null
                  ? "—"
                  : `${formatSignedNumber(sportsEvaluation.brierSkillScore * 100, 1)}%`}
              </p>
              <p className="text-[11px] text-muted-foreground">Multiclass Brier score</p>
            </div>
            <p className="text-[11px] text-muted-foreground sm:col-span-2 lg:col-span-4">
              Measured live on synthetic demo data to demonstrate the evaluation pipeline — not
              evidence of performance on real markets or competitions. Full model cards, including
              limitations, are in the{" "}
              <Link
                href="/model-lab"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Model Lab
              </Link>
              .
            </p>
          </div>
        </Section>

        {/* ── Risk-first ───────────────────────────────────────────────────────────────── */}
        <Section
          id="risk"
          eyebrow="Risk-first approach"
          title="Uncertainty is part of every answer"
          intro="Risk is scored on one published four-level scale across assets, portfolios and match predictions — with the arithmetic shown, so a label is never a mystery."
          className="border-t bg-muted/30"
        >
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <ul className="grid gap-3 sm:grid-cols-2">
              {RISK_LEVELS.map((level) => (
                <li key={level} className="space-y-2 rounded-xl border bg-card p-4">
                  <RiskBadge level={level} />
                  <p className="text-sm text-muted-foreground">
                    <span className="sr-only">{RISK_LEVEL_LABELS[level]}: </span>
                    {RISK_COPY[level]}
                  </p>
                </li>
              ))}
            </ul>
            <CheckList
              items={[
                "Every prediction ships with its confidence and an uncertainty grade — and the disclaimer that it is not a guarantee.",
                "Portfolio risk combines volatility, drawdown, concentration and exposure; each factor's contribution is displayed.",
                "Backtests execute at the next open with fees and slippage, and are tested for look-ahead leakage.",
                "Paper trading only. Real-money execution and wagering are out of scope for this phase.",
              ]}
            />
          </div>
        </Section>

        {/* ── Architecture ─────────────────────────────────────────────────────────────── */}
        <Section
          id="architecture"
          eyebrow="Platform architecture"
          title="Production-grade foundations"
          intro="Built as a modular monolith on Next.js with typed boundaries around every external dependency — data providers, brokers, databases and the Python ML service can each be swapped or scaled independently."
        >
          <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
            <ArchitectureDiagram />
            <div className="space-y-4 text-sm">
              <PreviewPanel title="Stack">
                <ul className="space-y-2">
                  {[
                    ["Web", "Next.js App Router · React · TypeScript (strict)"],
                    ["UI", "Tailwind CSS · shadcn/ui · Recharts"],
                    ["Data", "PostgreSQL · Drizzle ORM · Upstash Redis"],
                    ["ML", "Python · FastAPI · scikit-learn · XGBoost"],
                    ["Quality", "Vitest · pytest · ESLint · Ruff · CI"],
                  ].map(([label, value]) => (
                    <li key={label} className="flex flex-col gap-0.5">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="font-medium">{value}</span>
                    </li>
                  ))}
                </ul>
              </PreviewPanel>
              <PreviewPanel title="Security posture">
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  <li className="flex gap-2">
                    <ScrollText className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Append-only
                    audit trail
                  </li>
                  <li className="flex gap-2">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Strict CSP &
                    security headers
                  </li>
                  <li className="flex gap-2">
                    <Gauge className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Validated inputs &
                    rate limits
                  </li>
                </ul>
              </PreviewPanel>
            </div>
          </div>
        </Section>

        {/* ── CTA ──────────────────────────────────────────────────────────────────────── */}
        <section aria-labelledby="cta-title" className="border-t">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 sm:py-20 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl space-y-2">
              <h2 id="cta-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
                See the intelligence layer at work
              </h2>
              <p className="text-muted-foreground">
                Explore markets, fixtures, backtests and a paper portfolio in the demo platform — no
                sign-up, synthetic data, no real money.
              </p>
            </div>
            <Button size="lg" asChild>
              <Link href="/dashboard">
                Enter Demo Platform <ArrowRight />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────────────────── */}
      <footer className="border-t bg-muted/30">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="space-y-4">
            <EsocityWordmark showTagline />
            <p className="max-w-sm text-sm text-muted-foreground">{siteConfig.description}</p>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">{siteConfig.disclaimer}</span>{" "}
              {siteConfig.financialDisclaimer} {siteConfig.sportsDisclaimer}
            </p>
          </div>
          <nav aria-label="Platform" className="space-y-3 text-sm">
            <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Platform
            </p>
            <ul className="space-y-2">
              {[
                ["/dashboard", "Overview"],
                ["/markets", "Markets"],
                ["/sports", "Sports"],
                ["/trade", "Paper trading"],
                ["/backtesting", "Backtesting"],
                ["/model-lab", "Model Lab"],
              ].map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="text-muted-foreground hover:text-foreground">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Resources" className="space-y-3 text-sm">
            <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Resources
            </p>
            <ul className="space-y-2">
              <li>
                <a href="#methodology" className="text-muted-foreground hover:text-foreground">
                  Methodology
                </a>
              </li>
              <li>
                <a href="#risk" className="text-muted-foreground hover:text-foreground">
                  Risk approach
                </a>
              </li>
              <li>
                <a href="#architecture" className="text-muted-foreground hover:text-foreground">
                  Architecture
                </a>
              </li>
              <li>
                <Link href="/reports" className="text-muted-foreground hover:text-foreground">
                  Reports
                </Link>
              </li>
            </ul>
          </nav>
        </div>
        <div className="border-t">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>
              © {year} {siteConfig.name}. All rights reserved.
            </p>
            <p className="tracking-wide opacity-80">
              Engineered by {siteConfig.engineeringPartner}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
