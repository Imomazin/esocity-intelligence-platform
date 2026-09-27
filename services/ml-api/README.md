# Esocity ML API

FastAPI service providing the Python side of Esocity Intelligence. It is **optional**: the
Next.js app calls it when `ML_API_URL` is set and falls back to its built-in TypeScript engines
on any timeout, error or invalid response.

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Liveness, version, model inventory, XGBoost availability |
| `POST /predict/sports` | `x-api-key` | Poisson / Dixon–Coles football probabilities |
| `POST /predict/market` | `x-api-key` | Composite signal + gradient-boosted direction probability |
| `POST /backtest` | `x-api-key` | Long/flat single-asset backtest (next-open execution, costs) |

OpenAPI schema: `/openapi.json`; interactive docs: `/docs` (disable with `DOCS_ENABLED=false`).

## Models

- **sports.poisson-dixon-coles 2.1.0** and **markets.composite-signal 1.3.0** are exact ports of
  the TypeScript engines. `tests/test_parity.py` checks them against fixtures generated from the
  web app (`pnpm parity:fixtures` at the repo root).
- **ml.gbm-direction 0.1.0** (development) — XGBoost (or scikit-learn HistGradientBoosting when
  XGBoost is not installed) estimating P(close higher after the horizon) from 14 causal features.
  Validated walk-forward with `TimeSeriesSplit(gap=horizon)`; the response always includes the
  cross-validated AUC so a weak model is visible as weak. Probabilities are clamped to [0.02, 0.98].

All outputs are probabilistic estimates, not guaranteed outcomes.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `ESOCITY_ENV` | `development` | `production` makes `ML_API_KEY` mandatory (startup fails without it) |
| `ML_API_KEY` | unset | Shared secret (≥16 chars) sent by the web app as `x-api-key` |
| `MAX_BODY_BYTES` | `2000000` | Larger requests are rejected with 413 |
| `DOCS_ENABLED` | `true` | Serve `/docs` |
| `RANDOM_SEED` | `42` | Seed for every learner (reproducible results) |
| `LOG_LEVEL` | `info` | |

## Development

```bash
cd services/ml-api
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/ruff check . && .venv/bin/ruff format --check .
.venv/bin/pytest
```

Or with plain pip: `python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`.
