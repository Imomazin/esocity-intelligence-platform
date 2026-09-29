# Deploying to Vercel

The first deployment needs **no environment variables and no paid services**: it runs in demo
mode on synthetic data. Optional services can be added afterwards without code changes.

## Steps

1. **Merge the foundation** into `main` (or pick the branch you want to deploy).
2. **Import the repository** — vercel.com → _Add New… → Project_ → import
   `Imomazin/esocity-intelligence-platform`.
3. **Framework and root** — Framework preset **Next.js** (auto-detected); Root Directory: the
   repository root (`./`). Leave Build/Install/Output commands at their defaults (pnpm is detected
   from `pnpm-lock.yaml` / `packageManager`).
4. **Node.js version** — Project Settings → General → Node.js Version: **24.x** (matches
   `engines.node` and `.nvmrc`).
5. **Environment variables** — for the first deploy set only:
   | Variable                                                                          | Value                | Environments        |
   | --------------------------------------------------------------------------------- | -------------------- | ------------------- |
   | `DEMO_MODE`                                                                       | `true`               | Production, Preview |
   | `NEXT_PUBLIC_APP_NAME`                                                            | `Esocity` (optional) | All                 |
   | Everything else is optional (see step 8). Do **not** set `NEXT_OUTPUT` on Vercel. |
6. **Deploy** — click _Deploy_. The build runs lint-free `next build`; expect ~1–2 minutes.
7. **Verify** —
   - `https://<your-app>.vercel.app/` renders the landing page; _Enter Demo Platform_ opens `/dashboard`.
   - `https://<your-app>.vercel.app/api/health` returns `200` with `"status": "ok"`.
   - Place a paper order on `/trade`; it appears in the order history and on `/admin` (audit).
   - Optional: set `NEXT_PUBLIC_APP_URL` to your custom domain for canonical metadata.
8. **Add optional services** (redeploy after each):
   - **PostgreSQL** (Vercel Marketplace: Neon / Supabase) → set `DATABASE_URL`
     (`?sslmode=require`), then from your machine run `DATABASE_URL=… pnpm db:migrate && pnpm db:seed`.
   - **Upstash Redis** (Marketplace) → `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
     for shared rate limits and durable demo paper accounts without a database.
   - **ML API** (deployed separately, see ML_SERVICE.md) → `ML_API_URL`, `ML_API_KEY`
     (optionally `ML_API_TIMEOUT_MS`).
   - `/api/health` and `/admin` show each dependency's status after redeploying.
9. **Licensed data (optional)** — requires PostgreSQL. Full guide: DATA_PIPELINE.md.
   1. Set `POLYGON_API_KEY` and/or `API_FOOTBALL_KEY` (Production only; never `NEXT_PUBLIC_`),
      optionally `MARKET_DATA_SYMBOLS`, `API_FOOTBALL_LEAGUES` and the plan quotas.
   2. From your machine, with the production `DATABASE_URL` and keys:
      `pnpm ingest markets --dry-run`, then `pnpm ingest markets` and `pnpm ingest sports` for
      the initial backfill.
   3. Set `MARKET_DATA_PROVIDER=polygon` / `SPORTS_DATA_PROVIDER=api-football` and
      `CRON_SECRET` (`openssl rand -hex 32`), then redeploy. The crons in `vercel.json` keep the
      data current (weekdays 22:15 UTC for markets, daily 06:15 UTC for football); check
      Admin → Data pipeline after the first scheduled run.
   4. Hobby plans run crons once a day with hourly precision, which fits both schedules. The
      ingestion route declares `maxDuration = 300` and stops starting new items after 240 s.

## Notes

- Preview deployments are excluded from indexing (`robots.txt`) and get a CSP that allows the
  Vercel toolbar.
- Keep `DEMO_MODE=true` until an authentication provider is attached (docs/SECURITY.md);
  `DEMO_MODE=false` without one intentionally reports `down` and redirects to the landing page.
- Serverless memory is per instance: without Upstash or PostgreSQL, a demo paper account may reset
  on a cold start (the Trade page says so).
- Builds never need the database: with a licensed provider, data-driven pages render per
  request, so a deployment succeeds before the first ingestion. Until data exists those pages show
  an error naming the missing data, `/api/health` reports the domain `down`, and the landing page
  hides its live preview.
- `vercel.json` also schedules the crons on demo deployments; for domains still on `demo` the
  endpoint answers "skipped" and does nothing.
