# Security

This document describes the controls that **exist in code today**, the known gaps, and the
exact attach points for what comes next. Nothing here is aspirational unless marked as such.

## Principles

- No secrets in the repository — placeholders only in `.env.example`; `pnpm check:secrets` runs
  in CI; `.gitignore` excludes `.env*`, keys and certificates.
- Paper trading only — `getBrokerAdapter()` refuses non-paper adapters; configuration review
  reports `BROKER_ADAPTER != paper` as an error (health → 503).
- Validate every input on the server (Zod), never trust the client.
- Fail loudly in production; degrade visibly (not silently) in demo mode.

## Authentication

**Current state: demo mode only.** `DEMO_MODE=true` gives every visitor the shared fictional
"Demo Analyst" identity. This is _not_ authentication — there are no accounts, passwords or PII.
An anonymous random UUID in an httpOnly, `SameSite=Lax`, `Secure` (production) cookie
(`esocity_demo_sid`, 30 days) only isolates one browser's paper portfolio from another's.

With `DEMO_MODE=false`, `getSession()` returns `null`, the platform layout redirects to
`/?auth=required`, write APIs return 401, and configuration review reports the missing provider.

**Attach point: `lib/auth/session.ts` → `getSession()`** (plus `getSessionFromRequest()` for
route handlers). Everything else already consumes `PlatformSession` (`user.id`, `role`).

### Clerk

1. `pnpm add @clerk/nextjs`; set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` in Vercel.
2. Wrap `app/layout.tsx` children in `<ClerkProvider>`; add `proxy.ts` with `clerkMiddleware()`
   protecting `/(dashboard|markets|sports|trade|backtesting|watchlist|model-lab|reports|admin|settings)(.*)`
   and `/api/trade/(.*)`.
3. In `getSession()`: `const { userId } = await auth()`; upsert `users` by
   `(auth_provider='clerk', auth_subject=userId)`; map role from Clerk org roles / metadata.
4. Replace `writableSession()` / `ensureWritableSession()` so paper accounts are keyed by `users.id`.
5. Update the CSP (`next.config.ts`) with Clerk's frontend API origins.

### Auth.js

1. `pnpm add next-auth@beta @auth/drizzle-adapter`; create `auth.ts` with providers and the Drizzle
   adapter (add its tables via `pnpm db:generate`); `AUTH_SECRET` (≥32 chars) is required.
2. In `getSession()`: `const session = await auth()`; map `session.user` to `SessionUser`.
3. Protect routes in `proxy.ts` with the exported `auth` wrapper.

### Authorisation

`UserRole` = viewer | analyst | admin. The admin console checks `role === "admin"` server-side.
In demo mode the (read-only, secret-free) admin console is visible to everyone.

## Web and API controls (implemented)

| Control                                                                                                       | Where                                               |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| CSP, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, COOP, HSTS (prod)               | `next.config.ts`                                    |
| `Cache-Control: no-store` on `/api/*`                                                                         | `next.config.ts`                                    |
| Same-origin check for non-GET API calls (CSRF defence in depth)                                               | `lib/api/handler.ts`                                |
| Server Actions: Next.js origin checks + input re-validation + rate limit                                      | `features/trade/actions.ts`                         |
| JSON content-type enforcement and 64 KB body limit                                                            | `parseJsonBody`                                     |
| Zod validation of params, query and body; strict symbol / id patterns                                         | route handlers, `lib/api/schemas.ts`                |
| Rate limits: reads 240/min, orders 30/min, backtests 20/min per client                                        | `lib/security/rate-limit.ts`                        |
| Opaque 500s; public health reports sanitised error summaries (no hosts/ports)                                 | `lib/api/response.ts`, `lib/security/safe-error.ts` |
| Env validated at startup; config review never prints values                                                   | `lib/env.ts`                                        |
| Audit trail with sensitive-key redaction; append-only DB trigger                                              | `lib/audit`, migration `0001`                       |
| Platform pages `noindex`; API disallowed in robots                                                            | `app/(platform)/layout.tsx`, `app/robots.ts`        |
| ML service: constant-time API-key check, mandatory key in production, 413 on large bodies, non-root container | `services/ml-api`                                   |

### CSP trade-off

`script-src` includes `'unsafe-inline'` because App Router hydration uses inline scripts and a
nonce-based policy forces every page to render dynamically (losing ISR). Mitigations: no
`dangerouslySetInnerHTML` of user content, React escaping, strict `object-src`/`base-uri`/
`frame-ancestors`. Upgrade path: nonce via `proxy.ts` once pages are per-user anyway (post-auth).

### Rate limiting caveats

Fixed-window, keyed by the first `x-forwarded-for` hop (set by Vercel's edge). Without Upstash
the counters are per instance. Limits fail open (logged) if the store is unavailable, to keep
the demo usable — revisit for production.

## Audit trail

`recordAuditEvent()` writes a structured log line, an in-memory ring buffer (admin console) and,
with PostgreSQL, a row in `audit_events`. A trigger raises on `UPDATE`/`DELETE`, so the trail is
append-only even for application credentials. In production mode a failed audit insert fails the
action. Retention purges require a reviewed maintenance transaction that temporarily disables
the trigger under a privileged role.

## Infrastructure guidance

- **Vercel**: keep secrets in Environment Variables scoped per environment; enable Deployment
  Protection for previews; never expose server variables with `NEXT_PUBLIC_`.
- **PostgreSQL**: TLS (`sslmode=require`), a least-privilege app role (no DDL; migrations run
  with a separate role), pooled connections (`prepare: false` is already set), PITR backups.
- **Redis/Upstash**: separate databases per environment; token scoped to one database.
- **Data providers**: keys server-side only; cache and ingest on schedules; respect licences.
- **Brokers (future)**: see PAPER_TRADING.md → Path to live execution.

## Known gaps (tracked in ROADMAP)

Real authentication; per-user authorisation on data; nonce CSP; distributed rate limiting by
user; dependency and container scanning in CI; formal threat model; penetration test before any
live-money feature.

## Reporting

Report vulnerabilities privately to the repository owners (GitHub → Security → Report a
vulnerability). Do not open public issues for security problems.
