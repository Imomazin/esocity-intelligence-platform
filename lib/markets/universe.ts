import type { AssetProfile } from "@/lib/markets/types";

/**
 * Demo universe. Tickers and company descriptions are real; ALL PRICES ARE SYNTHETIC — they are
 * produced by lib/markets/synthetic.ts and do not reflect actual market history.
 */

export interface SyntheticParameters {
  /** Price at the synthetic epoch. */
  startPrice: number;
  /** Sensitivity to the simulated market factor. */
  beta: number;
  /** Annualised idiosyncratic drift. */
  alpha: number;
  /** Annualised idiosyncratic volatility. */
  idioVol: number;
  /** Long-run growth of the mean-reversion anchor (keeps paths plausible over years). */
  anchorGrowth: number;
  /** Whether the asset has its own slowly varying latent drift (momentum source). */
  idiosyncraticDrift: boolean;
  baseVolume: number;
}

export interface DemoAsset {
  profile: AssetProfile;
  synthetic: SyntheticParameters;
}

export const DEMO_ASSETS: readonly DemoAsset[] = [
  {
    profile: {
      symbol: "AAPL",
      name: "Apple Inc.",
      assetClass: "equity",
      exchange: "NASDAQ",
      sector: "Technology",
      industry: "Consumer Electronics",
      currency: "USD",
      description:
        "Designs smartphones, personal computers, wearables and services including the App Store, iCloud and payments.",
    },
    synthetic: {
      startPrice: 178,
      beta: 1.1,
      alpha: 0.02,
      idioVol: 0.17,
      anchorGrowth: 0.09,
      idiosyncraticDrift: true,
      baseVolume: 58_000_000,
    },
  },
  {
    profile: {
      symbol: "MSFT",
      name: "Microsoft Corporation",
      assetClass: "equity",
      exchange: "NASDAQ",
      sector: "Technology",
      industry: "Software — Infrastructure",
      currency: "USD",
      description:
        "Cloud infrastructure (Azure), productivity software, developer tools, gaming and enterprise AI platforms.",
    },
    synthetic: {
      startPrice: 335,
      beta: 1.0,
      alpha: 0.03,
      idioVol: 0.15,
      anchorGrowth: 0.1,
      idiosyncraticDrift: true,
      baseVolume: 24_000_000,
    },
  },
  {
    profile: {
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      assetClass: "equity",
      exchange: "NASDAQ",
      sector: "Technology",
      industry: "Semiconductors",
      currency: "USD",
      description:
        "Accelerated computing: GPUs and networking for data centres, AI training and inference, gaming and automotive.",
    },
    synthetic: {
      startPrice: 30,
      beta: 1.6,
      alpha: 0.14,
      idioVol: 0.3,
      anchorGrowth: 0.3,
      idiosyncraticDrift: true,
      baseVolume: 280_000_000,
    },
  },
  {
    profile: {
      symbol: "AMZN",
      name: "Amazon.com, Inc.",
      assetClass: "equity",
      exchange: "NASDAQ",
      sector: "Consumer Cyclical",
      industry: "Internet Retail",
      currency: "USD",
      description:
        "E-commerce marketplace, logistics, advertising and Amazon Web Services cloud computing.",
    },
    synthetic: {
      startPrice: 170,
      beta: 1.2,
      alpha: 0.02,
      idioVol: 0.21,
      anchorGrowth: 0.07,
      idiosyncraticDrift: true,
      baseVolume: 45_000_000,
    },
  },
  {
    profile: {
      symbol: "GOOGL",
      name: "Alphabet Inc. (Class A)",
      assetClass: "equity",
      exchange: "NASDAQ",
      sector: "Communication Services",
      industry: "Internet Content & Information",
      currency: "USD",
      description:
        "Search, YouTube, Android, Google Cloud and advertising technology, plus long-horizon bets such as Waymo.",
    },
    synthetic: {
      startPrice: 145,
      beta: 1.05,
      alpha: 0.03,
      idioVol: 0.19,
      anchorGrowth: 0.09,
      idiosyncraticDrift: true,
      baseVolume: 30_000_000,
    },
  },
  {
    profile: {
      symbol: "META",
      name: "Meta Platforms, Inc.",
      assetClass: "equity",
      exchange: "NASDAQ",
      sector: "Communication Services",
      industry: "Internet Content & Information",
      currency: "USD",
      description:
        "Social and messaging platforms (Facebook, Instagram, WhatsApp), digital advertising and AR/VR hardware.",
    },
    synthetic: {
      startPrice: 335,
      beta: 1.25,
      alpha: 0.05,
      idioVol: 0.27,
      anchorGrowth: 0.12,
      idiosyncraticDrift: true,
      baseVolume: 17_000_000,
    },
  },
  {
    profile: {
      symbol: "TSLA",
      name: "Tesla, Inc.",
      assetClass: "equity",
      exchange: "NASDAQ",
      sector: "Consumer Cyclical",
      industry: "Auto Manufacturers",
      currency: "USD",
      description: "Electric vehicles, battery energy storage, solar and autonomy software.",
    },
    synthetic: {
      startPrice: 390,
      beta: 1.8,
      alpha: -0.02,
      idioVol: 0.42,
      anchorGrowth: 0.02,
      idiosyncraticDrift: true,
      baseVolume: 95_000_000,
    },
  },
  {
    profile: {
      symbol: "SPY",
      name: "SPDR S&P 500 ETF Trust",
      assetClass: "etf",
      exchange: "NYSE Arca",
      sector: "Broad Market ETF",
      industry: "Large Blend",
      currency: "USD",
      description:
        "Exchange-traded fund tracking the S&P 500 index of large-capitalisation US equities. Used as the benchmark.",
    },
    synthetic: {
      startPrice: 476,
      beta: 1.0,
      alpha: 0,
      idioVol: 0.01,
      anchorGrowth: 0.08,
      idiosyncraticDrift: false,
      baseVolume: 75_000_000,
    },
  },
];

export const BENCHMARK_SYMBOL = "SPY";

export const DEMO_SYMBOLS = DEMO_ASSETS.map((asset) => asset.profile.symbol);

export function findDemoAsset(symbol: string): DemoAsset | undefined {
  const normalised = symbol.trim().toUpperCase();
  return DEMO_ASSETS.find((asset) => asset.profile.symbol === normalised);
}
