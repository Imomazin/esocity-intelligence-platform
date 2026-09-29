# CLAUDE.md — Esocity Intelligence

Guidance for AI coding agents and engineers working in this repository.

## Product

**Esocity Intelligence** — _Predictive Intelligence for Markets & Sport._ One platform with four
modules that must feel like a single product:

- **Esocity Core** — dashboard, watchlist, reports, model lab, admin, settings, audit.
- **Esocity Markets** — indicators, regimes, explainable composite signal, calibrated probabilities, backtesting.
- **Esocity Sports** — Poisson / Dixon–Coles football model: scorelines, 1X2, goals markets, uncertainty.
- **Esocity Trade** — paper trading and portfolio risk. **Paper only.**

Engineering partner: **AX** (AX / Ambidexters). Brand credit is subtle: "Engineered by AX" in the
landing footer only.

## Non-negotiable rules

1. **Probabilities, not promises.** Every prediction is shown as a probability with confidence /
   uncertainty and the disclaimer "Probabilistic intelligence, not guaranteed outcomes." Never
   write copy implying certainty or guaranteed returns.
2. **No real-money execution or wagering.** Only `PaperBrokerAdapter` may be constructed.
   `getBrokerAdapter()` refuses anything else. Do not add live broker credentials or betting flows.
3. **Never commit secrets** (API keys, tokens, passwords, connection strings). Placeholders only
   in `.env.example`. Run `pnpm check:secrets`.
4. **No look-ahead.** Indicators, features and strategies must be causal. Backtests execute at the
   next bar's open. Tests assert truncation invariance — keep them passing.
5. **Don't silently swallow production errors.** Demo mode may degrade (with a visible warning);
   production mode (`DEMO_MODE=false`) must fail loudly.
6. **The web app never depends on the Python service.** Every ML call has a TypeScript fallback.
7. Institutional fintech tone and styling — not gambling-style (no odds boards, neon, "bet" CTAs).

## Architecture (short)

- Next.js App Router at the repo root; Server Components by default; client components only for
  interactivity. Route handlers in `app/api/*` wrap `apiRoute()` (request ids, rate limits,
  same-origin writes, central error mapping, `{data, meta}` / `{error, meta}` envelopes).
- `lib/` holds pure engines (`markets`, `sports`, `trade`, `backtesting`) plus platform services
  (`env`, `api`, `auth`, `kv`, `audit`, `ml`, `security`). `features/<module>/` holds queries,
  server actions and feature components. `components/` is the shared design system.
- Providers are behind interfaces: `MarketDataProvider`, `SportsDataProvider`, `BrokerAdapter`,
  `IntelligenceEngine`, `PaperTradingStore`, `KeyValueStore`. Data: synthetic `demo` providers by
  default; licensed Polygon.io / API-Football data is **ingested into PostgreSQL** (cron route or
  `pnpm ingest`) and served by the `Stored*Provider`s — pages never call provider APIs. Brokers:
  paper only. See docs/DATA_PIPELINE.md.
- Provider HTTP goes through `ProviderHttpClient` (`lib/providers/http.ts`): keys in headers only,
  Zod-validated payloads, typed `ProviderError`s. Market sessions for licensed data use the NYSE
  calendar (`lib/markets/calendar.ts`); store only completed sessions.
- UI copy must match the configured data: use `provider.isSimulated` / `getDataSources()` — never
  hard-code "synthetic" or "live".
- Auth attach point: `lib/auth/session.ts` (demo mode today; Clerk / Auth.js documented).
- Config is validated once in `lib/env.ts`; read env through `getServerEnv()`, not `process.env`.
- PostgreSQL via Drizzle (`db/`), optional in demo mode. Audit table is append-only (DB trigger).
- Python ML service in `services/ml-api` mirrors the TS engines; parity is enforced by
  `pnpm parity:fixtures` + `tests/unit/parity-fixtures.test.ts` + `tests/test_parity.py`.

## Workflow

```bash
pnpm dev
pnpm lint && pnpm typecheck && pnpm test && pnpm build
TEST_DATABASE_URL=postgresql://… pnpm test:db   # repositories + ingestion against a disposable DB
cd services/ml-api && .venv/bin/ruff check . && .venv/bin/pytest
```

- Changed a mirrored engine (football model, indicators, composite signal, backtester)? Update
  the Python port and run `pnpm parity:fixtures`.
- Changed the schema? `pnpm db:generate`, review the SQL, commit the migration.
- Charts follow the dataviz rules in the codebase: one y-axis per chart, legend for ≥2 series,
  table view via `ChartFrame`, status colours only with icon + label.
- Toolchain pins: TypeScript 6.0 (typescript-eslint peer range), ESLint 9 (eslint-plugin-react
  incompatibility with ESLint 10). See docs/ARCHITECTURE.md → Toolchain decisions.
