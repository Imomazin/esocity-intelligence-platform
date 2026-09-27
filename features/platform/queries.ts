import "server-only";

import { getUniverseAnalysis } from "@/features/markets/queries";
import { getNow } from "@/lib/clock";
import { formatProbability } from "@/lib/format";
import { getSportsDataProvider } from "@/lib/sports/providers";
import { predictMatch } from "@/lib/sports/football-model";

export interface PlatformNotification {
  id: string;
  kind: "signal" | "match" | "model" | "system";
  severity: "info" | "success" | "warning";
  title: string;
  body: string;
  href: string;
  at: string;
}

export interface CommandItem {
  id: string;
  group: "Pages" | "Assets" | "Matches";
  label: string;
  hint?: string;
  href: string;
  keywords?: string;
}

export interface ShellData {
  notifications: PlatformNotification[];
  commands: CommandItem[];
}

const PAGE_COMMANDS: CommandItem[] = [
  {
    id: "page-dashboard",
    group: "Pages",
    label: "Overview",
    href: "/dashboard",
    keywords: "home dashboard pulse",
  },
  {
    id: "page-markets",
    group: "Pages",
    label: "Markets",
    href: "/markets",
    keywords: "stocks equities signals",
  },
  {
    id: "page-sports",
    group: "Pages",
    label: "Sports",
    href: "/sports",
    keywords: "football matches",
  },
  {
    id: "page-football",
    group: "Pages",
    label: "Football fixtures",
    href: "/sports/football",
    keywords: "fixtures results standings",
  },
  {
    id: "page-trade",
    group: "Pages",
    label: "Trade (paper)",
    href: "/trade",
    keywords: "orders portfolio positions",
  },
  {
    id: "page-backtesting",
    group: "Pages",
    label: "Backtesting",
    href: "/backtesting",
    keywords: "strategy simulation",
  },
  { id: "page-watchlist", group: "Pages", label: "Watchlist", href: "/watchlist" },
  {
    id: "page-model-lab",
    group: "Pages",
    label: "Model Lab",
    href: "/model-lab",
    keywords: "models calibration",
  },
  { id: "page-reports", group: "Pages", label: "Reports", href: "/reports", keywords: "brief" },
  {
    id: "page-admin",
    group: "Pages",
    label: "Admin",
    href: "/admin",
    keywords: "system health audit",
  },
  {
    id: "page-settings",
    group: "Pages",
    label: "Settings",
    href: "/settings",
    keywords: "preferences theme",
  },
];

/** Data for the platform shell: derived notifications and the command palette index. */
export async function getShellData(): Promise<ShellData> {
  const now = getNow();
  const [universe, matches] = await Promise.all([
    getUniverseAnalysis(),
    getSportsDataProvider().listMatches({ status: ["scheduled", "live"], limit: 24 }),
  ]);

  const signalNotifications: PlatformNotification[] = universe.assets
    .filter((asset) => asset.signalHistory[0]?.date === universe.asOf)
    .map((asset) => ({
      id: `signal-${asset.profile.symbol}-${universe.asOf}`,
      kind: "signal" as const,
      severity: "info" as const,
      title: `${asset.profile.symbol} signal changed to ${asset.signal.signal}`,
      body: `Composite score ${asset.signal.score >= 0 ? "+" : "−"}${Math.abs(asset.signal.score).toFixed(2)} · confidence ${formatProbability(asset.signal.confidence)}.`,
      href: `/markets/${asset.profile.symbol}`,
      at: `${universe.asOf}T21:00:00.000Z`,
    }));

  const topConviction = [...universe.assets].sort(
    (a, b) => b.signal.confidence - a.signal.confidence,
  )[0];
  const convictionNotification: PlatformNotification[] = topConviction
    ? [
        {
          id: `conviction-${topConviction.profile.symbol}-${universe.asOf}`,
          kind: "signal",
          severity: "info",
          title: `Highest conviction: ${topConviction.profile.symbol} ${topConviction.signal.signal}`,
          body: `P(up, ${universe.horizonDays}d) ${formatProbability(topConviction.signal.probabilityUp)} · ${topConviction.signal.regime.replace("_", " ").toLowerCase()} regime.`,
          href: `/markets/${topConviction.profile.symbol}`,
          at: `${universe.asOf}T21:05:00.000Z`,
        },
      ]
    : [];

  const nextMatches = matches
    .slice(0, 12)
    .map((match) => ({ match, prediction: predictMatch(match.modelInputs) }));
  const uncertain = nextMatches.find(({ prediction }) => prediction.uncertainty === "VERY_HIGH");
  const favourite = [...nextMatches].sort(
    (a, b) =>
      Math.max(b.prediction.outcome.home, b.prediction.outcome.away) -
      Math.max(a.prediction.outcome.home, a.prediction.outcome.away),
  )[0];
  const matchNotifications: PlatformNotification[] = [
    ...(favourite
      ? [
          {
            id: `favourite-${favourite.match.id}`,
            kind: "match" as const,
            severity: "info" as const,
            title: `Strongest favourite: ${favourite.match.homeTeam.shortName} v ${favourite.match.awayTeam.shortName}`,
            body: `Home ${formatProbability(favourite.prediction.outcome.home)} · Draw ${formatProbability(favourite.prediction.outcome.draw)} · Away ${formatProbability(favourite.prediction.outcome.away)}.`,
            href: `/sports/match/${favourite.match.id}`,
            at: new Date(now.getTime() - 45 * 60_000).toISOString(),
          },
        ]
      : []),
    ...(uncertain
      ? [
          {
            id: `uncertain-${uncertain.match.id}`,
            kind: "match" as const,
            severity: "warning" as const,
            title: `Very high uncertainty: ${uncertain.match.homeTeam.shortName} v ${uncertain.match.awayTeam.shortName}`,
            body: "Outcome probabilities are close to even — treat any single view with caution.",
            href: `/sports/match/${uncertain.match.id}`,
            at: new Date(now.getTime() - 90 * 60_000).toISOString(),
          },
        ]
      : []),
  ];

  const standingNotifications: PlatformNotification[] = [
    {
      id: `model-eval-${universe.asOf}`,
      kind: "model",
      severity: "success",
      title: "Daily model evaluation completed",
      body: `Composite signal walk-forward hit rate ${formatProbability(universe.evaluation.directionalHitRate ?? 0)} on ${universe.evaluation.directionalCalls.toLocaleString("en-US")} calls.`,
      href: "/model-lab",
      at: `${universe.asOf}T22:00:00.000Z`,
    },
    {
      id: "system-demo-data",
      kind: "system",
      severity: "info",
      title: "You are viewing synthetic demo data",
      body: "Prices, fixtures and results are simulated. Nothing here is a real market or match.",
      href: "/admin",
      at: `${universe.asOf}T08:00:00.000Z`,
    },
  ];
  const notifications = [
    ...signalNotifications,
    ...convictionNotification,
    ...matchNotifications,
    ...standingNotifications,
  ].sort((a, b) => b.at.localeCompare(a.at));

  const commands: CommandItem[] = [
    ...PAGE_COMMANDS,
    ...universe.assets.map((asset) => ({
      id: `asset-${asset.profile.symbol}`,
      group: "Assets" as const,
      label: `${asset.profile.symbol} · ${asset.profile.name}`,
      hint: asset.signal.signal,
      href: `/markets/${asset.profile.symbol}`,
      keywords: `${asset.profile.sector} ${asset.profile.industry}`,
    })),
    ...matches.slice(0, 12).map((match) => ({
      id: `match-${match.id}`,
      group: "Matches" as const,
      label: `${match.homeTeam.name} v ${match.awayTeam.name}`,
      hint: match.kickoffAt.slice(0, 10),
      href: `/sports/match/${match.id}`,
      keywords: match.competitionKey,
    })),
  ];

  return { notifications, commands };
}
