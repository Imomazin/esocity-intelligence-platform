import type { BrokerAdapterId } from "@/lib/env";
import type { ProviderDescriptor } from "@/lib/markets/providers/registry";

/**
 * Broker adapters. Only the paper broker is implemented. Live adapters are documentation-only
 * placeholders and are REFUSED at runtime — see docs/PAPER_TRADING.md → "Path to live execution".
 */
export const BROKER_ADAPTERS: ProviderDescriptor<BrokerAdapterId>[] = [
  {
    id: "paper",
    name: "Esocity Paper Broker",
    status: "available",
    coverage: "Simulated market orders against demo quotes with commission and slippage",
    envVars: [],
    notes: "No external connectivity. The only adapter enabled in Phase 1.",
  },
  {
    id: "alpaca",
    name: "Alpaca",
    status: "planned",
    coverage: "US equities & ETFs; separate paper and live endpoints",
    envVars: ["ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY", "ALPACA_BASE_URL"],
    notes:
      "Start with Alpaca's own paper endpoint. Live trading requires the Phase 5 controls (compliance, per-user OAuth, limits, kill switch).",
  },
  {
    id: "ibkr",
    name: "Interactive Brokers",
    status: "planned",
    coverage: "Global multi-asset via Client Portal / TWS API",
    envVars: ["IBKR_GATEWAY_URL", "IBKR_ACCOUNT_ID"],
    notes:
      "Requires a hosted gateway session and institutional onboarding; never co-locate credentials with the web tier.",
  },
];
