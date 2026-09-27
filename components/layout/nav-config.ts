import {
  ArrowLeftRight,
  ChartCandlestick,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Star,
  Timer,
  Trophy,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
  /** Match nested routes (e.g. /markets/NVDA highlights Markets). */
  matchPrefix?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Intelligence",
    items: [
      {
        title: "Overview",
        href: "/dashboard",
        icon: LayoutDashboard,
        description: "Platform pulse",
      },
      {
        title: "Markets",
        href: "/markets",
        icon: ChartCandlestick,
        description: "Signals & analytics",
        matchPrefix: true,
      },
      {
        title: "Sports",
        href: "/sports",
        icon: Trophy,
        description: "Match probabilities",
        matchPrefix: true,
      },
      { title: "Trade", href: "/trade", icon: ArrowLeftRight, description: "Paper trading" },
      {
        title: "Backtesting",
        href: "/backtesting",
        icon: Timer,
        description: "Strategy simulation",
      },
      { title: "Watchlist", href: "/watchlist", icon: Star, description: "Tracked assets" },
    ],
  },
  {
    label: "Research",
    items: [
      {
        title: "Model Lab",
        href: "/model-lab",
        icon: FlaskConical,
        description: "Model cards & calibration",
      },
      { title: "Reports", href: "/reports", icon: FileText, description: "Intelligence briefs" },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Admin", href: "/admin", icon: ShieldCheck, description: "Health & audit" },
      { title: "Settings", href: "/settings", icon: Settings, description: "Preferences" },
    ],
  },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.href) return true;
  return Boolean(item.matchPrefix && pathname.startsWith(`${item.href}/`));
}
