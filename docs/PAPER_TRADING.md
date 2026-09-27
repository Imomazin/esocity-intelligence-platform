# Paper trading

**Paper only. No real orders are routed anywhere.** `lib/trade/*`, `features/trade/*`.

## Components

| Piece                      | Responsibility                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `BrokerAdapter`            | Contract for any broker (`getAccount`, `placeOrder`, `resetAccount`)                                                      |
| `PaperBrokerAdapter`       | Simulated fills against market-data quotes                                                                                |
| `getBrokerAdapter()`       | Returns the paper broker; **throws** for any other `BROKER_ADAPTER`                                                       |
| `PaperTradingStore`        | Persistence: `PostgresPaperTradingStore` (row lock) or `KeyValuePaperTradingStore` (per-account mutex; memory or Upstash) |
| Ledger (`ledger.ts`)       | Event-sourced state: cash, holdings, realised P&L, fees derived by replaying orders                                       |
| Portfolio (`portfolio.ts`) | Positions, exposure, allocation, concentration (HHI), history, volatility                                                 |
| Risk (`risk.ts`)           | Four-factor portfolio risk score                                                                                          |

## Execution model

- Market orders only, filled immediately at the current (simulated) quote.
- Fill price = reference × (1 ± 5 bps slippage), adverse to the trader; rounded to cents.
- Commission = max($1, 5 bps × notional).
- Accounting: average cost; buy commissions are capitalised into cost basis; sell commissions
  reduce proceeds and realised P&L. Short selling is disabled.

## Validation (server-side, in this order)

| Check                                        | Rejection               | HTTP |
| -------------------------------------------- | ----------------------- | ---- |
| Account has < 500 orders                     | `ORDER_LIMIT_REACHED`   | 422  |
| Whole number 1–100,000                       | `INVALID_QUANTITY`      | 422  |
| Symbol in the tradable universe with a quote | `UNKNOWN_SYMBOL`        | 422  |
| Cash covers notional + commission            | `INSUFFICIENT_CASH`     | 422  |
| Sell ≤ current holding                       | `INSUFFICIENT_POSITION` | 422  |
| Malformed body / wrong types                 | `VALIDATION_ERROR`      | 400  |

Rejected orders are **recorded** in the order history with their reason, and audited. A
post-trade concentration above 35% adds a warning (not a rejection).

Concurrency: validation and append happen inside the store's `mutate()` — a PostgreSQL
`SELECT … FOR UPDATE` on the account row, or a per-account promise mutex for the key-value store —
so concurrent orders can never overspend cash (tested). Caveat: the key-value mutex is
per server instance; with Upstash, two instances writing the same demo account at the same
instant resolve last-write-wins. Use PostgreSQL wherever strict consistency matters.

## Storage and identity

- Demo visitors get an anonymous UUID in the httpOnly `esocity_demo_sid` cookie on their first
  write; until then they see a read-only preview of the seeded demo portfolio.
- With `DATABASE_URL`: PostgreSQL (durable). Without: Upstash (durable) or memory (per instance —
  may reset on cold starts; the UI says so).
- Demo mode only: if PostgreSQL is unreachable, the key-value store is used with a visible warning.
  Production mode never falls back.

## Portfolio risk score (0–100)

| Factor                           | Points | Scale               |
| -------------------------------- | ------ | ------------------- |
| Ex-ante volatility               | 35     | 8% → 40% annualised |
| Max drawdown (simulated history) | 25     | 0% → 25%            |
| Largest position weight          | 25     | 10% → 50%           |
| Gross exposure                   | 15     | 50% → 100%          |

Linear between floor and cap; bands LOW < 25 ≤ MODERATE < 50 ≤ HIGH < 75 ≤ VERY HIGH. Each
factor's points are shown in the UI.

## Path to live execution (Phase 5 — not started)

Live trading requires, at minimum: legal/compliance review per jurisdiction; per-user broker
OAuth (never shared keys); credentials in a secrets manager, never in the web tier; pre-trade risk
limits (notional, position, loss) enforced server-side; a global kill switch; idempotent order
submission (`client_order_id`); reconciliation against broker fills; full audit; start with the
broker's own paper endpoint (Alpaca paper). Registered placeholders: Alpaca, Interactive Brokers.
