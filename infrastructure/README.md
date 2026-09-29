# Infrastructure

Deployment topology for Esocity Intelligence. Infrastructure-as-code (Terraform) is planned for
Phase 6; today the platform deploys with managed services and the files at the repo root.

| Component       | Development                          | Production (recommended)                                                                          |
| --------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Web app         | `pnpm dev`                           | Vercel (Next.js, Node 24) — see docs/VERCEL_DEPLOYMENT.md                                         |
| PostgreSQL      | `docker compose up postgres`         | Neon / Supabase via Vercel Marketplace, or AWS RDS                                                |
| Redis           | `docker compose up redis redis-rest` | Upstash Redis (REST)                                                                              |
| ML API          | `docker compose up ml-api`           | Container host (Fly.io, Render, Cloud Run, AWS App Runner/ECS) using `services/ml-api/Dockerfile` |
| Self-hosted web | `docker build -t esocity-web .`      | Root `Dockerfile` (Next.js standalone, non-root)                                                  |

Environments: `development` (local), `preview` (Vercel previews, demo mode), `production`.
Keep separate databases, Redis instances and ML API keys per environment.

Health: web `GET /api/health` (503 when a required dependency or configuration fails, including
licensed data with nothing servable; `degraded` when it is stale); ML `GET /health`. Both are
suitable for uptime monitors and container health checks.

Scheduled jobs: `vercel.json` declares the licensed-data ingestion crons
(`/api/cron/ingest/markets`, `/api/cron/ingest/sports`), authenticated with `CRON_SECRET`.
Outside Vercel, call the same endpoints from any scheduler with
`Authorization: Bearer $CRON_SECRET`, or run `pnpm ingest <domain>` — see docs/DATA_PIPELINE.md.
