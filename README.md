# Esocity Intelligence Platform

Esocity Intelligence is a predictive intelligence platform for financial markets and sports analytics, engineered by AX.

**Predictive Intelligence for Markets & Sport** — turn complex market and sporting data into
probabilities, signals and decision intelligence. _Probabilistic intelligence, not guaranteed outcomes._

## Product modules

- **Esocity Core** — dashboard, watchlist, reports, model lab, admin console, settings, audit trail and the shared design system.
- **Esocity Markets** — market data, technical indicators, regime detection, an explainable composite BUY / HOLD / SELL signal with walk-forward calibrated probabilities, and backtesting.
- **Esocity Sports** — football match probabilities from a Poisson / Dixon–Coles goals model: full scoreline matrix, 1X2, over/under, both-teams-to-score, clean sheets, confidence and uncertainty.
- **Esocity Trade** — paper trading only: simulated market orders with fees and slippage, positions, P&L, exposure and a transparent portfolio risk score. No real broker execution.

## Engineering principles

- Probabilistic forecasts, never guaranteed predictions.
- Paper trading and validation before live execution — live execution and wagering are out of scope for this phase.
- Server-side risk controls and immutable (append-only) audit trails.
- Secrets must never be committed to Git.
- Modular architecture that can evolve from an MVP monorepo into separately scalable services.

## Status — MVP foundation + real-data pipeline (Phase 2)

A complete, running demo platform: every page, API route and engine works **without any
external service or API key**. PostgreSQL, Redis and the Python ML service are optional
upgrades that the app detects and uses when configured — and with PostgreSQL, licensed
**Polygon.io** market data and **API-Football** fixtures and results can replace the synthetic
data, one domain at a time ([data pipeline](docs/DATA_PIPELINE.md)).

| Area                 | What exists                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web app              | Next.js App Router at the repo root: landing page, 12 platform pages, 12 API routes                                                                  |
| Engines (TypeScript) | Indicators, regimes, composite signal, walk-forward calibration, Poisson/Dixon–Coles, team ratings, paper broker, ledger, portfolio risk, backtester |
| Data                 | Deterministic synthetic markets (8 symbols) and a fictional football season (22 clubs) by default                                                    |
| Licensed data        | Polygon.io daily bars and API-Football fixtures, xG and availability: scheduled ingestion, validation, NYSE calendar, freshness monitoring           |
| Database             | PostgreSQL + Drizzle: 24 tables, migrations, append-only audit trigger, ingestion run log, idempotent seed                                           |
| ML service           | FastAPI (Python 3.12): sports, market (XGBoost direction model), backtest — parity-tested against the TypeScript engines                             |
| Quality              | Vitest unit/API suites, PostgreSQL integration tests, 63 pytest tests, ESLint, Prettier, Ruff, strict TypeScript, CI workflow                        |

## Quick start

Requirements: Node.js 24 (`.nvmrc`), pnpm 10 (`corepack enable`). Optional: Docker, Python 3.12.

```bash
pnpm install
pnpm dev                 # http://localhost:3000 — demo mode, no configuration needed
```

Open the landing page and choose **Enter Demo Platform**.

### Optional local services

```bash
cp .env.example .env.local
docker compose up -d                       # PostgreSQL, Redis (+ REST proxy), ML API
# then set DATABASE_URL / UPSTASH_* / ML_API_URL in .env.local (see docs/ARCHITECTURE.md)
pnpm db:migrate && pnpm db:seed
```

### Licensed data (optional)

```bash
# .env.local: DATABASE_URL, POLYGON_API_KEY and/or API_FOOTBALL_KEY (see .env.example)
pnpm ingest markets --dry-run      # fetch + validate, write nothing
pnpm ingest markets                # backfill daily bars into PostgreSQL
pnpm ingest sports                 # fixtures, results, xG, availability
# then MARKET_DATA_PROVIDER=polygon and/or SPORTS_DATA_PROVIDER=api-football
```

In production, Vercel Cron keeps the data current (`vercel.json`, authenticated by
`CRON_SECRET`). See [docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md).

## Scripts

| Command                                                 | Purpose                                                  |
| ------------------------------------------------------- | -------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm start`                | Develop, build, serve                                    |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check`    | Static checks                                            |
| `pnpm test` / `pnpm test:unit` / `pnpm test:api`        | Vitest suites                                            |
| `TEST_DATABASE_URL=… pnpm test:db`                      | PostgreSQL integration tests (disposable database)       |
| `pnpm ingest <markets\|sports> [--dry-run]`             | Ingest licensed data (same path as the scheduled job)    |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` | Drizzle migrations and demo seed (`--reset` to truncate) |
| `pnpm parity:fixtures`                                  | Regenerate TS → Python parity fixtures                   |
| `pnpm check:secrets`                                    | Secret scan of tracked files                             |
| `pnpm validate`                                         | lint + typecheck + test                                  |

ML service: see [`services/ml-api/README.md`](services/ml-api/README.md).

## Repository layout

```
app/              Next.js routes: landing, (platform) pages, api/* route handlers, metadata
components/       Design system: ui (shadcn), layout, charts, indicators, data display
features/         Feature modules (queries, server actions, feature components)
lib/              Engines and platform libraries (markets, sports, trade, backtesting, ml, auth, api, kv, audit,
                  providers, ingestion)
db/               Drizzle schema, migrations, seed, repositories
services/ml-api/  Python FastAPI ML service
tests/            Vitest unit, API and PostgreSQL integration tests
docs/             Product, architecture, engines, security, deployment, roadmap
infrastructure/   Deployment topology notes
scripts/          Tooling (ingestion CLI, parity fixtures, secret scan)
```

## Documentation

[Product](docs/PRODUCT.md) · [Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md) ·
[Markets engine](docs/MARKETS_ENGINE.md) · [Sports engine](docs/SPORTS_ENGINE.md) ·
[Data pipeline](docs/DATA_PIPELINE.md) ·
[Paper trading](docs/PAPER_TRADING.md) · [ML service](docs/ML_SERVICE.md) · [Security](docs/SECURITY.md) ·
[Vercel deployment](docs/VERCEL_DEPLOYMENT.md) · [Roadmap](docs/ROADMAP.md)

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui · Lucide ·
Recharts · Zod · PostgreSQL + Drizzle ORM · Upstash Redis · Python 3.12 · FastAPI · Pydantic v2 ·
pandas · NumPy · scikit-learn · XGBoost · Vitest · pytest · Ruff · GitHub Actions · Vercel.

The original proposal also lists TimescaleDB, LightGBM, PyTorch, Docker and AWS; Docker files are
included, and the remaining items are scheduled in [docs/ROADMAP.md](docs/ROADMAP.md).

## Disclaimer

Esocity outputs are model estimates for research and education. They are not personalised
financial advice, an offer or solicitation to trade, or betting advice. Esocity does not offer
wagering services. All demo data is synthetic; paper trading uses virtual money only.
