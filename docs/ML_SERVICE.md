# ML service

`services/ml-api` — Python 3.12, FastAPI, Pydantic v2, NumPy, pandas, scikit-learn, XGBoost.

## Role

1. **Parity engines** — exact ports of the football model, indicators, composite signal and
   backtester, so heavier research (and future Python-only models) can share one codebase with
   the production formulas.
2. **Gradient-boosted direction model** (`ml.gbm-direction` v0.1.0, _development_): XGBoost
   (fallback: scikit-learn HistGradientBoosting) predicting P(close higher after the horizon) from
   14 causal features (returns 1/5/21/63d, RSI, MACD histogram %, distance to SMA20/50, vol,
   vol percentile, trend strength, drawdown, composite score, volume ratio).
   - Labels exist only where the future close is known; the latest `horizon` rows are never trained on.
   - Walk-forward CV: `TimeSeriesSplit(n_splits=5, gap=horizon)`; response includes mean ± std AUC.
   - Permutation importance on the latest fold; probability clamped to [0.02, 0.98].
   - Minimum 250 labelled samples, otherwise `ml: null` with a note.

## API

| Method | Path              | Auth        | Body → response                                                         |
| ------ | ----------------- | ----------- | ----------------------------------------------------------------------- |
| GET    | `/health`         | none        | `{status, service, version, xgboost_available, models[]}`               |
| POST   | `/predict/sports` | `x-api-key` | team inputs → λ, matrix, 1X2, markets, confidence, uncertainty, factors |
| POST   | `/predict/market` | `x-api-key` | `{symbol, horizon_days, bars[]}` → composite + ML supplement            |
| POST   | `/backtest`       | `x-api-key` | strategy config + bars → metrics, equity curve, trades                  |

OpenAPI at `/openapi.json`, docs at `/docs`. Requests are strictly validated (unknown fields
rejected, bars strictly date-ordered with consistent OHLC, size ≤ `MAX_BODY_BYTES`). Invalid
input → 422; bad key → 401; oversized → 413.

## Integration with the web app

`lib/ml/engine.ts` → `RemoteIntelligenceEngine` when `ML_API_URL` is set:

- `AbortSignal.timeout(ML_API_TIMEOUT_MS)` (default 2.5 s), `x-api-key` header;
- every response is validated with the Zod contracts in `lib/ml/contracts.ts`;
- on timeout / error / invalid payload the local TypeScript engine answers and the UI shows
  which engine produced the result (and why it fell back).

## Parity

`pnpm parity:fixtures` writes `services/ml-api/tests/fixtures/parity.json` from the TS engines;
`tests/test_parity.py` requires the Python output to match (1e-9 relative for probabilities),
and `tests/unit/parity-fixtures.test.ts` fails if the TS engines change without regenerating.

## Deploy

Container: `services/ml-api/Dockerfile` (non-root, healthcheck). Suitable hosts: Fly.io, Render,
Railway, AWS App Runner / ECS, Cloud Run. Set `ESOCITY_ENV=production` and `ML_API_KEY`
(startup fails without it), then set `ML_API_URL` and the same `ML_API_KEY` in Vercel.
Keep the service private or behind the key; it is server-to-server only (no CORS).
