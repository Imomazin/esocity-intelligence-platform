# Product — Esocity Intelligence

**Predictive Intelligence for Markets & Sport.** Esocity turns complex market and sporting data
into probabilities, signals and decision intelligence. _Probabilistic intelligence, not
guaranteed outcomes._

## Users

| Persona                          | Needs                                                                    |
| -------------------------------- | ------------------------------------------------------------------------ |
| Market analyst / active investor | Explainable signals, regime context, calibrated probabilities, backtests |
| Sports analyst / data journalist | Match probabilities, scoreline distributions, uncertainty, model quality |
| Portfolio-curious learner        | A risk-free paper account to practise execution and understand risk      |
| Operator / administrator         | Health, configuration review, provider registry, audit trail             |

## Modules

### Esocity Core

Overview dashboard (market pulse, sports pulse, portfolio value, paper P&L, prediction
performance, model confidence, watchlist, recent signals, upcoming matches, risk status,
recent activity), watchlist, reports (print / PDF), Model Lab (model cards with live
walk-forward metrics and calibration), admin console, settings, ⌘K command menu, notifications.

### Esocity Markets

`/markets` universe screen and `/markets/[symbol]` asset pages for the configured universe
(default AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA and SPY — synthetic in demo mode, licensed
end-of-day data with Polygon.io): price with SMA 20/50, volume, RSI, MACD, regime, composite signal
with its weighted components, calibrated probability of a higher close in 20 trading days,
expected move, risk score, signal history and methodology. Not personalised advice.

### Esocity Sports

`/sports`, `/sports/football` (filters) and `/sports/match/[id]`: expected goals (λ) with every
adjustment itemised, 1X2, over/under 1.5/2.5/3.5, both teams to score, clean sheets, the full
0–0…6–6 scoreline matrix, most likely scorelines, confidence and uncertainty grade, standings,
form. In demo mode, fictional clubs make synthetic output impossible to mistake for real
fixtures; with API-Football, real competitions are labelled as licensed data and every
probability still carries its uncertainty and the "not betting advice" disclaimer.

### Esocity Trade

`/trade`: $100,000 virtual account, market BUY/SELL ticket with a pre-trade estimate, server-side
validation (insufficient cash, insufficient position, invalid quantity, unknown symbol, order
limit), open and closed positions, realised/unrealised P&L, order history including rejections,
exposure, allocation, concentration and a transparent four-factor risk score.

### Backtesting

`/backtesting`: SMA crossover (20/50), 3-month time-series momentum and the composite signal,
with commission and slippage, next-open execution, buy-and-hold benchmark, equity and drawdown
curves, trade list and metrics.

## Positioning and tone

Institutional fintech: calm palette, dense but legible data, precise language. Never
gambling-style: no odds boards, no "bet now", no urgency mechanics. Every probability carries
its uncertainty and a disclaimer.

## Out of scope for this phase

Real-money trading, broker connectivity, wagering, personalised advice, user accounts
(demo mode only; auth architecture documented), real-time or intraday data (licensed data is
end-of-day).

## Success criteria for the MVP

- A first Vercel deploy works with zero configuration (`DEMO_MODE=true`).
- Every number on screen is reproducible from documented formulas.
- Model quality is shown honestly (including weak skill) in the Model Lab.
