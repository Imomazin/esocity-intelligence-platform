# Roadmap

## Phase 1 — MVP foundation ✅ (this release)

Next.js platform (Core, Markets, Sports, Trade, Backtesting, Model Lab, Reports, Admin,
Settings), deterministic synthetic data, explainable composite signal with walk-forward
calibration, Poisson / Dixon–Coles football model, paper trading with risk scoring, PostgreSQL
schema + migrations + seed, Python ML service with parity tests, CI, Vercel-ready demo mode.

## Phase 2 — Real data

- Implement Polygon.io (or Twelve Data) `MarketDataProvider`; scheduled ingestion into
  `market_prices` (Vercel Cron or a worker); corporate-action adjustments.
- Implement SportMonks / API-Football `SportsDataProvider`: fixtures, results, xG, injuries.
- TimescaleDB (or partitioning) for prices; data-quality monitoring and staleness alerts.
- Re-fit and re-evaluate every model on real data; publish results in the Model Lab.

## Phase 3 — Accounts and personalisation

- Clerk or Auth.js at `lib/auth/session.ts`; roles; per-user paper accounts in PostgreSQL.
- Server-side watchlists, preferences, notifications (email digest), saved backtests.
- Nonce-based CSP, per-user rate limits, dependency/container scanning in CI.

## Phase 4 — Model depth

- Markets: fundamentals and cross-sectional features; LightGBM / XGBoost promoted from
  development only if walk-forward skill is stable; probabilistic return ranges.
- Sports: time-decayed ratings, lineup-aware xG, player models; bivariate Poisson comparison.
- Model registry workflow (train → evaluate → approve → deploy) backed by `model_versions`/`model_runs`;
  drift monitoring; PyTorch where sequence models add value.

## Phase 5 — Controlled broker integration

- Alpaca **paper** endpoint first via `BrokerAdapter`; then, only after legal/compliance review:
  per-user OAuth, secrets manager, pre-trade limits, kill switch, reconciliation, full audit.
- No wagering integrations are planned.

## Phase 6 — Scale and enterprise

- Split services where load demands (ingestion, ML inference, API) on AWS/containers.
- Enterprise data (Bloomberg / LSEG, Opta) under licence; SSO/SAML; tenant isolation; SLAs;
  SOC 2 readiness; subscriptions and billing.
