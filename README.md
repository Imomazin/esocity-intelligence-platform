# Esocity Intelligence Platform

Esocity Intelligence is a predictive intelligence platform for financial markets and sports analytics, engineered by AX.

## Initial product scope

- **Esocity Markets** — market data, forecasting, signals, backtesting and portfolio intelligence.
- **Esocity Sports** — match probabilities, score/goal modelling, team/player analytics and odds intelligence.
- **Esocity Trade** — paper trading first, followed by controlled broker/exchange integrations where appropriate.
- **Esocity Core** — authentication, users, subscriptions, audit logs, notifications and administration.

## Engineering principles

- Probabilistic forecasts, never guaranteed predictions.
- Paper trading and validation before live execution.
- Server-side risk controls and immutable audit trails.
- Secrets must never be committed to Git.
- Modular architecture that can evolve from an MVP monorepo into separately scalable services.

## Proposed stack

- Next.js + React + TypeScript
- Python + FastAPI
- PostgreSQL + TimescaleDB
- Redis
- Python ML stack: scikit-learn, XGBoost/LightGBM, PyTorch
- Docker
- AWS
- GitHub Actions

## Status

Repository initialized. Product architecture and MVP implementation are next.
