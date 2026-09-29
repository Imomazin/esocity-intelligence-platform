# Data model

PostgreSQL via Drizzle ORM. Schema: `db/schema/*.ts`; migrations: `db/migrations/*.sql`;
seed: `db/seed.ts`. **Optional in demo mode** — the app runs without a database.

Conventions: UUID primary keys (`gen_random_uuid()`), `created_at` / `updated_at` timestamps
(`timestamptz`), money as `numeric(20,6)`, prices `numeric(18,6)`, ratios `numeric(14,6)`, explicit foreign keys with
deliberate `ON DELETE` behaviour, `CHECK` constraints for invariants, and indexes for every
access path the app uses.

## Tables (24)

| Domain  | Table                             | Purpose / notable constraints                                                                       |
| ------- | --------------------------------- | --------------------------------------------------------------------------------------------------- |
| Users   | `users`                           | Identity (`auth_provider` + `auth_subject` unique) — ready for Clerk / Auth.js                      |
|         | `user_preferences`                | 1:1 preferences (theme, risk profile)                                                               |
| Markets | `assets`                          | Tradable universe (`symbol` unique)                                                                 |
|         | `market_prices`                   | OHLCV bars; unique `(asset_id, interval, ts)`; positivity and OHLC consistency checks               |
|         | `market_signals`                  | Composite signal snapshots with score, confidence, probability, components (jsonb)                  |
|         | `watchlists`, `watchlist_items`   | Per-user watchlists; unique `(watchlist_id, asset_id)`                                              |
| Sports  | `sports`, `competitions`, `teams` | Reference data (`key` unique)                                                                       |
|         | `matches`                         | Fixtures/results; home ≠ away check; indexes on competition/kick-off                                |
|         | `match_predictions`               | λ, 1X2, markets, score matrix (jsonb), confidence, uncertainty, model version                       |
| Models  | `model_versions`                  | Model registry (`key` + `version` unique, status)                                                   |
|         | `model_runs`                      | Evaluation / training runs with metrics (jsonb)                                                     |
| Trading | `paper_accounts`                  | Virtual accounts; `cash >= 0`, `starting_cash > 0`                                                  |
|         | `paper_orders`                    | Order ledger incl. rejections; `quantity > 0`; unique `(account_id, client_order_id)` (idempotency) |
|         | `paper_positions`                 | Derived holdings cache; unique `(account_id, symbol)`; `quantity >= 0`                              |
|         | `paper_transactions`              | Cash movements; `balance_after >= 0`                                                                |
|         | `portfolio_snapshots`             | Daily valuation; unique `(account_id, as_of)`                                                       |
|         | `backtests`, `backtest_results`   | Run config (date-order, capital, cost checks) and 1:1 results with equity curve                     |
| System  | `notifications`                   | Per-user notifications with read state                                                              |
|         | `audit_events`                    | **Append-only** audit trail (trigger blocks UPDATE/DELETE)                                          |
|         | `ingestion_runs`                  | Licensed-data ingestion log; partial unique index = one `running` run per domain (a lease)          |

```mermaid
erDiagram
  users ||--o| user_preferences : has
  users ||--o{ watchlists : owns
  watchlists ||--o{ watchlist_items : contains
  assets ||--o{ watchlist_items : "listed in"
  assets ||--o{ market_prices : "priced by"
  assets ||--o{ market_signals : "scored by"
  model_versions ||--o{ market_signals : produced
  model_versions ||--o{ model_runs : evaluated
  sports ||--o{ competitions : has
  sports ||--o{ teams : has
  competitions ||--o{ matches : schedules
  teams ||--o{ matches : "home / away"
  matches ||--o{ match_predictions : predicted
  model_versions ||--o{ match_predictions : produced
  users ||--o{ paper_accounts : owns
  paper_accounts ||--o{ paper_orders : records
  paper_accounts ||--o{ paper_positions : holds
  paper_accounts ||--o{ paper_transactions : moves
  paper_accounts ||--o{ portfolio_snapshots : values
  paper_orders ||--o{ paper_transactions : settles
  users ||--o{ backtests : runs
  backtests ||--|| backtest_results : yields
  users ||--o{ notifications : receives
```

`audit_events.actor_id` is intentionally **not** a foreign key: audit rows must outlive the
actors they describe.

## Licensed data

Ingestion ([DATA_PIPELINE.md](DATA_PIPELINE.md)) writes into the same tables the demo seed uses,
kept apart by provenance:

- `market_prices.source` is the provider id (`polygon`); the stored provider reads only its own
  source, so demo-seeded bars (`source = 'demo'`) never mix in. A licensed upsert takes over a
  demo row for the same asset and date.
- Football rows use provider-prefixed keys: competitions `apif-l{league}` (one row per season),
  teams `apif-t{team}`, matches `external_ref = apif-{fixture}` (also the public match id).
- `matches.context` is a JSON document built by several writers — fixture sync (`provider`,
  `providerStatus`, `round`, `referee`), expected goals (`xg`, `xgChecked`) and availability
  (`availability.home/away.out/doubtful`, `checkedAt`) — so writes merge (`context || patch`)
  instead of replacing it.
- `ingestion_runs.items` holds the per-symbol / per-competition outcome of each run.

## Paper accounts in demo mode

Demo visitors are anonymous. Their account id is the random UUID in the `esocity_demo_sid`
cookie; `paper_accounts.user_id` is null for these accounts. With a database configured the
PostgreSQL store persists them; the order ledger is the source of truth and positions/cash are
rebuilt inside the same transaction (row lock on the account) on every mutation.

## Workflow

```bash
pnpm db:generate          # after editing db/schema — review the generated SQL
pnpm db:migrate           # apply migrations (uses DATABASE_URL)
pnpm db:seed              # upsert deterministic demo data (idempotent)
pnpm db:seed --reset      # truncate everything first (never against production)
```

Custom SQL (such as the audit trigger in `0001_audit_events_append_only.sql`) lives in its own
migration so it is reviewed like any other schema change.

## Future: time-series storage

Daily bars for a 50-symbol universe stay small (≈ 12,500 rows a year). Before intraday bars or
much larger universes, move `market_prices` to TimescaleDB hypertables (or partition by month)
and add continuous aggregates — see ROADMAP Phase 2. Note that a hypertable needs the time
column in every unique index, including the primary key.
