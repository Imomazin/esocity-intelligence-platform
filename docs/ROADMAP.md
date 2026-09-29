# Roadmap

## Phase 1 — MVP foundation ✅

Next.js platform (Core, Markets, Sports, Trade, Backtesting, Model Lab, Reports, Admin,
Settings), deterministic synthetic data, explainable composite signal with walk-forward
calibration, Poisson / Dixon–Coles football model, paper trading with risk scoring, PostgreSQL
schema + migrations + seed, Python ML service with parity tests, CI, Vercel-ready demo mode.

## Phase 2 — Real data (in progress)

Delivered ([DATA_PIPELINE.md](DATA_PIPELINE.md)):

- ✅ Polygon.io ingestion into `market_prices`: split-adjusted daily bars, NYSE calendar
  (holidays, early closes), completed sessions only, validation, restatement detection with
  atomic re-ingestion (split adjustments); served from PostgreSQL by `StoredMarketDataProvider`.
- ✅ API-Football ingestion: fixtures, 90-minute results, expected goals, availability, previous
  season as rating priors, per-run request budget; ratings rebuilt walk-forward from stored
  results by `StoredSportsDataProvider`.
- ✅ Scheduling (Vercel Cron with `CRON_SECRET`, `pnpm ingest` CLI with `--dry-run`), a run log
  with a per-domain lease, audit events.
- ✅ Data-quality monitoring: per-symbol / per-competition freshness in `/api/health` and
  Admin → Data pipeline; stale data degrades health, missing data fails it.
- ✅ Model Lab, reports and every page evaluate and label whichever data is configured.

Remaining:

- Dividend (total-return) adjustment and corporate-action history (`/v3/reference/splits`,
  dividends) as an explicit audit trail.
- Delayed intraday quotes (snapshot endpoint on paid plans) for paper fills during the session.
- Cup and continental fixtures for rest/fatigue; player-importance-weighted availability.
- Alerting on stale data (email/Slack) beyond health status.
- TimescaleDB (or partitioning) once intraday bars or large universes arrive.
- Twelve Data / SportMonks adapters behind the same ingestion interfaces.

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
