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
  EXT["Data providers<br/>demo now · Polygon, SportMonks… planned"]

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
  ADP -.-> EXT
```

## Layers

| Layer         | Location                                                                          | Rules                                                                                                |
| ------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Routes        | `app/`                                                                            | Server Components by default; `(platform)` group shares the shell; `api/*` handlers use `apiRoute()` |
| Features      | `features/<module>/`                                                              | `queries.ts` (server-only reads), `actions.ts` (Server Actions), `service.ts`, components            |
| Design system | `components/`                                                                     | `ui/` (shadcn, new-york), layout, charts (Recharts), indicators, data display                        |
| Engines       | `lib/markets`, `lib/sports`, `lib/trade`, `lib/backtesting`                       | Pure, deterministic, unit-tested; no I/O                                                             |
| Platform      | `lib/env`, `lib/api`, `lib/auth`, `lib/kv`, `lib/audit`, `lib/ml`, `lib/security` | Cross-cutting concerns                                                                               |
| Data          | `db/`                                                                             | Drizzle schema, SQL migrations, seed, repositories                                                   |
| ML            | `services/ml-api/`                                                                | FastAPI; mirrors TS engines; adds the gradient-boosted direction model                               |

## Key decisions

- **Demo-first runtime.** `DEMO_MODE=true` (default) uses deterministic synthetic data, an
  anonymous per-browser demo session and in-memory storage, so the first deploy needs nothing.
  Each optional dependency is detected from environment variables and reported in `/api/health`.
- **Graceful degradation, loud production.** In demo mode an unreachable database falls back to
  the key-value store with a visible warning; in production mode the same failure is an error.
- **Provider interfaces.** Swapping synthetic data for Polygon or SportMonks means implementing one
  interface; selecting an unimplemented provider fails configuration review instead of silently
  serving demo data.
- **Event-sourced paper ledger.** Positions and cash are derived by replaying orders, so every
  number is auditable. Stores serialise mutations per account (row lock / mutex).
- **Remote ML is optional.** `RemoteIntelligenceEngine` validates every response with Zod and
  falls back to the local engine on timeout, error or bad payload. On Vercel, a `localhost`
  `ML_API_URL` is ignored.
- **Caching.** Market/sports pages use ISR (`revalidate = 300`); universe analysis is memoised per
  market date; per-visitor pages (dashboard, trade, reports, admin, settings) are dynamic.

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
