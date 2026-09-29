# Markets engine

Model key `markets.composite-signal` v1.3.0 (`lib/markets/*`). All formulas below are what the
code computes; the asset page shows the same components and weights.

## Data

`MarketDataProvider` (`lib/markets/providers/types.ts`) supplies assets, daily bars, quotes and
the market session. `DemoMarketDataProvider` generates a **deterministic synthetic market** from
2022-01-03: a 3-state persistent Markov factor regime, GARCH(1,1) volatility clustering,
per-asset beta and an Ornstein–Uhlenbeck latent drift, weak mean reversion to an anchor, and
Brownian-bridge intraday quotes. Same inputs → same prices, everywhere.

**Licensed data (`MARKET_DATA_PROVIDER=polygon`).** Split-adjusted daily bars from Polygon.io
are ingested after each US close into `market_prices` (`source = 'polygon'`) and served by
`StoredMarketDataProvider` from PostgreSQL — see [DATA_PIPELINE.md](DATA_PIPELINE.md). The
session uses the NYSE calendar (`lib/markets/calendar.ts`: holidays, observance rules, 13:00 early
closes); only completed sessions are stored, and quotes are the last close labelled delayed.
Symbols need 130 bars before they are analysed. The engine formulas below are identical for
synthetic and licensed data.

Planned providers (documented placeholders, refused at runtime until implemented): Twelve Data,
Alpha Vantage, Financial Modeling Prep, Bloomberg / LSEG enterprise feeds.

### Adding a provider

1. Implement `MarketHistorySource` (`lib/markets/ingestion.ts`) in
   `lib/markets/providers/<name>.ts` on top of `ProviderHttpClient` (`lib/providers/http.ts`):
   split-adjusted daily `PriceBar`s keyed by exchange-local trading date, reference data mapped
   to `AssetProfile`, credentials in headers only.
2. Wire it into `lib/ingestion/service.ts` and serve it with `StoredMarketDataProvider` in
   `providers/index.ts` (`source` = the provider id); mark it `available` in `registry.ts` and
   `IMPLEMENTED_MARKET_PROVIDERS` in `lib/env.ts`.
3. Add adapter tests with recorded payloads (see `tests/unit/market-ingestion.test.ts`).
4. Respect licence terms for display and redistribution.

## Indicators (causal — value at t uses bars 0..t only)

| Indicator      | Definition                                                                       |
| -------------- | -------------------------------------------------------------------------------- |
| Returns        | r_t = c_t / c_{t−1} − 1                                                          |
| SMA(n)         | mean of the last n closes (20, 50)                                               |
| EMA(n)         | α = 2/(n+1), seeded with SMA(n)                                                  |
| RSI(14)        | Wilder: first averages = simple means of 14 changes, then avg = (prev·13 + x)/14 |
| MACD           | EMA12 − EMA26, signal EMA9 of MACD, histogram = MACD − signal                    |
| Momentum       | c_t / c_{t−n} − 1 for n = 21, 63                                                 |
| Volatility     | sample stdev of daily log returns over 20 / 63 days × √252                       |
| Vol percentile | mid-rank of 20-day vol within the trailing 252 days (≥ 60 samples)               |
| Trend strength | tanh((annualised OLS slope of log price ÷ annualised vol) × R²) over 50 days     |
| Drawdown       | c_t / max(c_0..c_t) − 1                                                          |

## Regime (evaluated in order)

1. **High volatility** — vol percentile ≥ 0.90
2. **Uptrend** — close > SMA50, SMA20 > SMA50, trend strength > 0.15
3. **Downtrend** — close < SMA50, SMA20 < SMA50, trend strength < −0.15
4. **Range-bound** — otherwise

## Composite signal

| Component  | Weight | Score in [−1, 1]                                                                    |
| ---------- | ------ | ----------------------------------------------------------------------------------- |
| Trend      | 30%    | 0.6 × trend strength + 0.4 × MA alignment (mean of three sign tests)                |
| Momentum   | 25%    | tanh((0.7 z₆₃ + 0.3 z₂₁)/1.5), z = momentum ÷ (vol₆₃ × √(n/252)), vol floored at 5% |
| RSI        | 15%    | 0.5(RSI−50)/50, reversing beyond 70/30 by 1.5 × excess/30                           |
| Volatility | 10%    | 0.5 − p for p ≤ 0.5, else −2(p − 0.5)                                               |
| Regime     | 20%    | Up 0.8 · Down −0.8 · Range 0 · High-vol −0.5                                        |

**BUY** if score ≥ 0.25, **SELL** if ≤ −0.25, otherwise **HOLD**.

**Confidence** = decisiveness × (0.55 + 0.45 × agreement) × (0.85 in high-volatility regimes),
clamped to [0.05, 0.95]. Decisiveness maps distance beyond the threshold to [0.5, 1] (HOLD:
distance inside the band to [0.5, 0.8] — absence of evidence never earns top-tier conviction);
agreement is the weighted share of components that support the call.

## Calibrated probability

Scores are mapped to P(close higher in 20 trading days) with a one-feature logistic regression
pooled across the universe: intercept unpenalised, slope ridge-penalised with L2 = 5 × horizon
(overlapping windows carry ~1/horizon of an independent observation). A sample is used only
once its label date has passed. Probabilities are clamped to [0.02, 0.98].

**Walk-forward evaluation**: expanding window, refit every 63 dates, minimum 1,000 training
samples; reports Brier score vs the base rate (Brier skill), log loss, directional hit rate
(BUY/SELL calls) and reliability bins — shown in the Model Lab, including when skill is small.

## Asset risk score (0–100)

45% × min(vol₂₀/0.6, 1) + 35% × min(|max drawdown 1Y|/0.5, 1) + 20% × vol percentile, graded
LOW < 25 ≤ MODERATE < 50 ≤ HIGH < 75 ≤ VERY HIGH.

## Limitations

Technical features only; 20-day horizon; no transaction-cost-aware sizing. The demo universe
is synthetic; licensed data is end-of-day, split-adjusted (not dividend-adjusted) and typically
two years deep, so walk-forward evaluation rests on a short history. Signals are research tools,
**not personalised financial advice**.
