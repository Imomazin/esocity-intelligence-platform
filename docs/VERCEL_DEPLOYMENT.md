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

## Notes

- Preview deployments are excluded from indexing (`robots.txt`) and get a CSP that allows the
  Vercel toolbar.
- Keep `DEMO_MODE=true` until an authentication provider is attached (docs/SECURITY.md);
  `DEMO_MODE=false` without one intentionally reports `down` and redirects to the landing page.
- Serverless memory is per instance: without Upstash or PostgreSQL, a demo paper account may reset
  on a cold start (the Trade page says so).
