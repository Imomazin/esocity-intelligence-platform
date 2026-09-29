# Architecture

Esocity is a **modular monolith** on Next.js (App Router) with typed seams around every external
dependency, plus an optional Python ML service. The web app is fully functional on its own.

```mermaid
flowchart TB
  subgraph Browser
    UI[Pages & client components]
  end
  subgraph Web["Esocity Web · Next.js (Vercel)"]
    RSC[Server Components / Server Actions]
    API["Route handlers /api/*<br/>apiRoute(): ids · rate limits · same-origin · errors"]
    ENG["Engines (lib/)<br/>markets · sports · trade · backtesting"]
    SVC["Platform services<br/>env · auth · kv · audit · ml client"]
    ADP["Adapters<br/>MarketDataProvider · SportsDataProvider<br/>BrokerAdapter · PaperTradingStore"]
  end
  PG[(PostgreSQL<br/>Drizzle · optional)]
  RD[(Upstash Redis<br/>optional)]
  ML["Python ML API<br/>FastAPI · optional"]
  EXT["Licensed providers<br/>Polygon.io · API-Football"]
  ING["Ingestion<br/>cron /api/cron/ingest · pnpm ingest"]

  UI --> RSC
  UI --> API
  RSC --> ENG
  API --> ENG
  ENG --> ADP
  RSC --> SVC
  API --> SVC
  SVC --> PG
  SVC --> RD
  SVC -. "timeout → TS fallback" .-> ML
  ADP --> PG
  ADP --> RD
  EXT --> ING --> PG
```

## Layers

| Layer         | Location                                                                          | Rules                                                                                                |
| ------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Routes        | `app/`                                                                            | Server Components by default; `(platform)` group shares the shell; `api/*` handlers use `apiRoute()` |
| Features      | `features/<module>/`                                                              | `queries.ts` (server-only reads), `actions.ts` (Server Actions), `service.ts`, components            |
| Design system | `components/`                                                                     | `ui/` (shadcn, new-york), layout, charts (Recharts), indicators, data display                        |
| Engines       | `lib/markets`, `lib/sports`, `lib/trade`, `lib/backtesting`                       | Pure, deterministic, unit-tested; no I/O                                                             |
| Platform      | `lib/env`, `lib/api`, `lib/auth`, `lib/kv`, `lib/audit`, `lib/ml`, `lib/security` | Cross-cutting concerns                                                                               |
| Data pipeline | `lib/providers`, `lib/ingestion`, provider adapters, `scripts/ingest.ts`          | HTTP client, ingestion runs, freshness monitoring; the only code that calls licensed APIs            |
| Data          | `db/`                                                                             | Drizzle schema, SQL migrations, seed, repositories                                                   |
| ML            | `services/ml-api/`                                                                | FastAPI; mirrors TS engines; adds the gradient-boosted direction model                               |

## Key decisions

- **Demo-first runtime.** `DEMO_MODE=true` (default) uses deterministic synthetic data, an
  anonymous per-browser demo session and in-memory storage, so the first deploy needs nothing.
  Each optional dependency is detected from environment variables and reported in `/api/health`.
- **Graceful degradation, loud production.** In demo mode an unreachable database falls back to
  the key-value store with a visible warning; in production mode the same failure is an error.
- **Provider interfaces.** Pages consume `MarketDataProvider` / `SportsDataProvider` only. The demo
  providers compute synthetic data in process; licensed providers (Polygon.io, API-Football) are
  **ingested into PostgreSQL on a schedule and served from it** by `StoredMarketDataProvider` /
  `StoredSportsDataProvider` — pages never call a provider API. Selecting an unimplemented
  provider fails configuration review instead of silently serving demo data. See
  [DATA_PIPELINE.md](DATA_PIPELINE.md).
- **Builds never need a database.** With a licensed provider, reads first call
  `renderAtRequestTime()` (Next.js `connection()`), so data-driven pages render per request
  instead of at build time; in-memory snapshots (60 s) keep them fast. Demo deployments keep
  static/ISR pages. The platform shell and the public landing page degrade (with a visible
  notice) when licensed data cannot be loaded, so System status always stays reachable; the
  affected pages still fail loudly, and the error page names the failing data domain.
- **Event-sourced paper ledger.** Positions and cash are derived by replaying orders, so every
  number is auditable. Stores serialise mutations per account (row lock / mutex).
- **Remote ML is optional.** `RemoteIntelligenceEngine` validates every response with Zod and
  falls back to the local engine on timeout, error or bad payload. On Vercel, a `localhost`
  `ML_API_URL` is ignored.
- **Caching.** With demo providers, market/sports pages use ISR (`revalidate = 300`); with licensed
  providers they render per request from cached snapshots. Universe analysis is memoised per
  market date and data version (a checksum of the stored bars, so re-ingested history
  invalidates it); per-visitor pages (dashboard, trade, reports, admin, settings) are dynamic.
  A successful cron run also revalidates cached pages.

## Request lifecycle (API)

1. `apiRoute()` assigns a request id, derives the client id (`x-forwarded-for`), enforces
   same-origin for writes and applies the fixed-window rate limit.
2. Inputs are parsed with Zod (`parseJsonBody` checks content type and a 64 KB limit).
3. Responses use `{ data, meta }`; errors use `{ error: { code, message, details? }, meta }` with
   the correct status (400/401/403/404/409/415/422/429/503). Unknown errors return an opaque 500.

## Local development

```bash
pnpm dev                     # demo mode, nothing else required
docker compose up -d         # optional: postgres, redis + REST proxy, ml-api
```

Licensed data locally: set the provider keys, then `pnpm ingest markets --dry-run` to verify and
`pnpm ingest markets` / `pnpm ingest sports` to load ([DATA_PIPELINE.md](DATA_PIPELINE.md)).
Repository and ingestion integration tests run against a disposable database:
`TEST_DATABASE_URL=… pnpm test:db`.

`.env.local` values for the compose stack (local throwaway credentials):

```
DATABASE_URL=postgresql://esocity:esocity_local_only@127.0.0.1:5432/esocity
UPSTASH_REDIS_REST_URL=http://127.0.0.1:8079
UPSTASH_REDIS_REST_TOKEN=esocity_local_only_token
ML_API_URL=http://127.0.0.1:8000
ML_API_KEY=esocity-local-only-ml-key
```

## Toolchain decisions

| Choice                                | Reason                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Next.js 16, React 19, Tailwind v4     | Current stable releases                                                                                                |
| TypeScript **6.0** (not 7)            | `typescript-eslint` peer range excludes TS 7 at time of writing                                                        |
| ESLint **9** (not 10)                 | `eslint-plugin-react` (via `eslint-config-next`) crashes on ESLint 10                                                  |
| shadcn/ui components authored in-repo | Same new-york v4 source, using the unified `radix-ui` package; the registry was unreachable from the build environment |
| `geist` npm package for fonts         | Self-hosted fonts; no Google Fonts request at build or runtime                                                         |
| `xgboost-cpu` wheel                   | CPU-only XGBoost (small image); service falls back to scikit-learn if absent                                           |
| Node 24                               | Current Vercel default LTS                                                                                             |
