import { BrainCircuit, ChartCandlestick, Trophy, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Delta } from "@/components/data/delta";
import { RegimeBadge } from "@/components/indicators/badges";
import { Card } from "@/components/ui/card";
import type { MarketOverview } from "@/features/markets/types";
import type { SportsOverview } from "@/features/sports/types";
import type { PaperTradingView } from "@/features/trade/types";
import { formatCurrency, formatPercent, formatProbability, formatSignedNumber } from "@/lib/format";

function PulseCard({
  eyebrow,
  icon,
  href,
  headline,
  children,
}: {
  eyebrow: string;
  icon: ReactNode;
  href: string;
  headline: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      <Link
        href={href}
        className="group flex h-full flex-col gap-3 rounded-xl p-4 focus-visible:outline-2"
      >
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {eyebrow}
          </p>
          <span className="text-muted-foreground group-hover:text-primary [&_svg]:size-4">
            {icon}
          </span>
        </div>
        <div className="text-2xl font-semibold tracking-tight">{headline}</div>
        <div className="mt-auto space-y-1 text-xs text-muted-foreground">{children}</div>
      </Link>
    </Card>
  );
}

export function PulseCards({
  market,
  sports,
  paper,
}: {
  market: MarketOverview;
  sports: SportsOverview;
  paper: PaperTradingView;
}) {
  const tone =
    market.breadth.averageScore > 0.15
      ? "Risk-on"
      : market.breadth.averageScore < -0.15
        ? "Risk-off"
        : "Mixed";
  const favourite = [...sports.upcoming].sort(
    (a, b) =>
      Math.max(b.prediction.home, b.prediction.away) -
      Math.max(a.prediction.home, a.prediction.away),
  )[0];
  const avgConfidence =
    sports.upcoming.length > 0
      ? sports.upcoming.reduce((total, match) => total + match.prediction.confidence, 0) /
        sports.upcoming.length
      : null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <PulseCard eyebrow="Market pulse" icon={<ChartCandlestick />} href="/markets" headline={tone}>
        <p>
          <span className="num font-medium text-foreground">{market.breadth.signalCounts.BUY}</span>{" "}
          buy ·{" "}
          <span className="num font-medium text-foreground">
            {market.breadth.signalCounts.HOLD}
          </span>{" "}
          hold ·{" "}
          <span className="num font-medium text-foreground">
            {market.breadth.signalCounts.SELL}
          </span>{" "}
          sell · avg score {formatSignedNumber(market.breadth.averageScore, 2)}
        </p>
        {market.benchmark && (
          <p className="flex flex-wrap items-center gap-1.5">
            SPY {formatCurrency(market.benchmark.price)}{" "}
            <Delta value={market.benchmark.changePercent} className="text-xs" />
            <RegimeBadge regime={market.benchmark.regime} className="py-0 text-[10px]" />
          </p>
        )}
      </PulseCard>

      <PulseCard
        eyebrow="Sports pulse"
        icon={<Trophy />}
        href="/sports"
        headline={
          <>
            {sports.upcoming.length}
            <span className="text-sm font-normal text-muted-foreground"> fixtures · 7 days</span>
          </>
        }
      >
        {favourite && (
          <p>
            Strongest favourite:{" "}
            <span className="font-medium text-foreground">
              {favourite.prediction.home >= favourite.prediction.away
                ? favourite.home.shortName
                : favourite.away.shortName}
            </span>{" "}
            {formatProbability(Math.max(favourite.prediction.home, favourite.prediction.away))}
          </p>
        )}
        <p>
          Average model confidence {avgConfidence === null ? "—" : formatProbability(avgConfidence)}
        </p>
      </PulseCard>

      <PulseCard
        eyebrow="Portfolio"
        icon={<Wallet />}
        href="/trade"
        headline={formatCurrency(paper.summary.totalValue)}
      >
        <p className="flex items-center gap-1.5">
          Today <Delta value={paper.summary.dayChangePercent} className="text-xs" />
        </p>
        <p className="flex items-center gap-1.5">
          Paper P&amp;L{" "}
          <Delta
            value={paper.summary.totalPnl}
            format="currency"
            showIcon={false}
            className="text-xs"
          />
          <span>({formatPercent(paper.summary.totalReturn, 2)})</span>
        </p>
      </PulseCard>

      <PulseCard
        eyebrow="Model performance"
        icon={<BrainCircuit />}
        href="/model-lab"
        headline={
          <>
            {market.evaluation.directionalHitRate === null
              ? "—"
              : formatPercent(market.evaluation.directionalHitRate, 0)}
            <span className="text-sm font-normal text-muted-foreground"> signal hit rate</span>
          </>
        }
      >
        <p>
          Football 1X2 accuracy{" "}
          <span className="font-medium text-foreground">
            {sports.evaluation.accuracy === null
              ? "—"
              : formatPercent(sports.evaluation.accuracy, 0)}
          </span>{" "}
          · Brier skill{" "}
          {sports.evaluation.brierSkillScore === null
            ? "—"
            : formatSignedNumber(sports.evaluation.brierSkillScore * 100, 1)}
          %
        </p>
        <p>Walk-forward, out-of-sample on synthetic demo data</p>
      </PulseCard>
    </div>
  );
}
