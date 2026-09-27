"""Event-driven daily backtester (long/flat, single asset, no leverage). Mirrors
lib/backtesting/engine.ts and lib/backtesting/strategies.ts.

Chronology per bar t (the no-look-ahead contract):
  1. At the OPEN of bar t, execute the target decided at the CLOSE of bar t−1.
  2. Mark the portfolio to market at the CLOSE of bar t.
  3. The decision for bar t (using bars[0..t] only) executes at bar t+1's open.
Bars after ``end_date`` are removed before any computation.
"""

from __future__ import annotations

import datetime as dt
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from app.features.indicators import rate_of_change, sma
from app.features.signals import build_feature_rows
from app.utils.numeric import TRADING_DAYS_PER_YEAR, js_round, mean, sample_std, sharpe_like_ratio


class BacktestInputError(ValueError):
    """Invalid backtest request (maps to HTTP 422)."""


@dataclass(frozen=True)
class Bar:
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class Strategy:
    id: str
    name: str
    warmup_bars: int
    targets: Callable[[Sequence[Bar]], list[int]]


def _sma_crossover(bars: Sequence[Bar]) -> list[int]:
    closes = [bar.close for bar in bars]
    fast, slow = sma(closes, 20), sma(closes, 50)
    return [1 if f is not None and s is not None and f > s else 0 for f, s in zip(fast, slow, strict=True)]


def _momentum(bars: Sequence[Bar]) -> list[int]:
    closes = [bar.close for bar in bars]
    roc, trend = rate_of_change(closes, 63), sma(closes, 50)
    return [
        1 if r is not None and t is not None and r > 0 and c > t else 0
        for c, r, t in zip(closes, roc, trend, strict=True)
    ]


def _composite(bars: Sequence[Bar]) -> list[int]:
    rows = build_feature_rows([b.date for b in bars], [b.close for b in bars], [b.volume for b in bars])
    position = 0
    targets: list[int] = []
    for row in rows:
        if row.signal == "BUY":
            position = 1
        elif row.signal == "SELL":
            position = 0
        targets.append(position)
    return targets


STRATEGIES: dict[str, Strategy] = {
    "sma_crossover": Strategy("sma_crossover", "SMA crossover (20/50)", 50, _sma_crossover),
    "momentum": Strategy("momentum", "Time-series momentum (3M)", 63, _momentum),
    "composite": Strategy("composite", "Composite Esocity signal", 80, _composite),
}


def _max_drawdown(values: Sequence[float]) -> float:
    peak = -math.inf
    worst = 0.0
    for value in values:
        peak = max(peak, value)
        worst = min(worst, value / peak - 1)
    return worst


def _daily_returns(values: Sequence[float]) -> list[float]:
    return [values[i + 1] / values[i] - 1 for i in range(len(values) - 1)]


def _days_between(a: str, b: str) -> int:
    delta = dt.date.fromisoformat(b) - dt.date.fromisoformat(a)
    return delta.days


def run_backtest(
    all_bars: Sequence[Bar],
    *,
    strategy_id: str,
    start_date: str,
    end_date: str,
    initial_capital: float,
    fee_bps: float,
    slippage_bps: float,
) -> dict:
    strategy = STRATEGIES.get(strategy_id)
    if strategy is None:
        raise BacktestInputError(f'Unknown strategy "{strategy_id}"')
    if start_date >= end_date:
        raise BacktestInputError("Start date must be before end date.")
    if not initial_capital > 0:
        raise BacktestInputError("Initial capital must be positive.")
    if fee_bps < 0 or slippage_bps < 0:
        raise BacktestInputError("Costs cannot be negative.")

    bars = [bar for bar in all_bars if bar.date <= end_date]
    start_index = next((i for i, bar in enumerate(bars) if bar.date >= start_date), -1)
    end_index = len(bars) - 1
    if start_index < 0 or end_index - start_index < 20:
        raise BacktestInputError("Date range must contain at least 20 trading days of data.")

    warnings: list[str] = []
    if start_index < strategy.warmup_bars:
        warnings.append(
            f"Only {start_index} bars of history precede the start date; the strategy needs "
            f"{strategy.warmup_bars} to warm up and stays in cash until then."
        )

    targets = strategy.targets(bars)
    fee_rate = fee_bps / 10_000
    slippage = slippage_bps / 10_000

    cash = initial_capital
    shares = 0
    fees_paid = 0.0
    days_in_market = 0
    trades: list[dict] = []
    open_trade: dict | None = None
    equity_curve: list[dict] = []

    first_bar = bars[start_index]
    benchmark_entry = first_bar.open * (1 + slippage)
    benchmark_shares = math.floor(initial_capital / (benchmark_entry * (1 + fee_rate)))
    benchmark_cash = (
        initial_capital - benchmark_shares * benchmark_entry - benchmark_shares * benchmark_entry * fee_rate
    )

    equity_peak = initial_capital
    for t in range(start_index, end_index + 1):
        bar = bars[t]
        signal_bar = bars[t - 1] if t > 0 else None
        desired = targets[t - 1] if t > 0 else 0

        if desired == 1 and shares == 0:
            price = bar.open * (1 + slippage)
            quantity = math.floor(cash / (price * (1 + fee_rate)))
            if quantity > 0:
                fee = quantity * price * fee_rate
                cash -= quantity * price + fee
                fees_paid += fee
                shares = quantity
                open_trade = {
                    "signal_date": signal_bar.date if signal_bar else bar.date,
                    "entry_date": bar.date,
                    "entry_price": js_round(price, 4),
                    "exit_signal_date": None,
                    "exit_date": None,
                    "exit_price": None,
                    "shares": quantity,
                    "pnl": -fee,
                    "return_pct": 0.0,
                    "holding_days": 0,
                    "open": True,
                }
        elif desired == 0 and shares > 0 and open_trade is not None:
            price = bar.open * (1 - slippage)
            fee = shares * price * fee_rate
            cash += shares * price - fee
            fees_paid += fee
            entry_cost = open_trade["entry_price"] * shares * (1 + fee_rate)
            exit_proceeds = shares * price - fee
            trades.append(
                {
                    **open_trade,
                    "exit_signal_date": signal_bar.date if signal_bar else bar.date,
                    "exit_date": bar.date,
                    "exit_price": js_round(price, 4),
                    "pnl": js_round(exit_proceeds - entry_cost, 2),
                    "return_pct": js_round(exit_proceeds / entry_cost - 1, 6),
                    "holding_days": _days_between(open_trade["entry_date"], bar.date),
                    "open": False,
                }
            )
            shares = 0
            open_trade = None

        equity = cash + shares * bar.close
        equity_peak = max(equity_peak, equity)
        if shares > 0:
            days_in_market += 1
        equity_curve.append(
            {
                "date": bar.date,
                "equity": js_round(equity, 2),
                "benchmark": js_round(benchmark_cash + benchmark_shares * bar.close, 2),
                "drawdown": js_round(equity / equity_peak - 1, 6),
                "exposure": 1 if shares > 0 else 0,
            }
        )

    last_bar = bars[end_index]
    if open_trade is not None:
        entry_cost = open_trade["entry_price"] * open_trade["shares"] * (1 + fee_rate)
        mark_value = open_trade["shares"] * last_bar.close
        trades.append(
            {
                **open_trade,
                "pnl": js_round(mark_value - entry_cost, 2),
                "return_pct": js_round(mark_value / entry_cost - 1, 6),
                "holding_days": _days_between(open_trade["entry_date"], last_bar.date),
                "open": True,
            }
        )

    equities = [point["equity"] for point in equity_curve]
    benchmarks = [point["benchmark"] for point in equity_curve]
    ending_capital = equities[-1] if equities else initial_capital
    benchmark_end = benchmarks[-1] if benchmarks else initial_capital
    strategy_returns = _daily_returns([initial_capital, *equities])
    benchmark_returns = _daily_returns([initial_capital, *benchmarks])
    years = len(equity_curve) / TRADING_DAYS_PER_YEAR
    total_return = ending_capital / initial_capital - 1
    benchmark_return = benchmark_end / initial_capital - 1
    wins = sum(1 for trade in trades if trade["pnl"] > 0)

    return {
        "strategy_name": strategy.name,
        "equity_curve": equity_curve,
        "trades": trades,
        "warnings": warnings,
        "assumptions": [
            "Signals are computed at each day's close using only data available at that close.",
            "Orders execute at the next trading day's open — never on the signal bar.",
            (
                f"Commission of {_format_bps(fee_bps)} bps and adverse slippage of "
                f"{_format_bps(slippage_bps)} bps on every fill."
            ),
            "Long/flat only: no leverage, no short selling, whole shares, idle cash earns nothing.",
            "Benchmark buys and holds the same asset from the first open with the same frictions.",
            "Computed by the Esocity ML service. Past (simulated) performance does not predict "
            "future results.",
        ],
        "metrics": {
            "starting_capital": initial_capital,
            "ending_capital": js_round(ending_capital, 2),
            "total_return": js_round(total_return, 6),
            "benchmark_return": js_round(benchmark_return, 6),
            "excess_return": js_round(total_return - benchmark_return, 6),
            "cagr": js_round((ending_capital / initial_capital) ** (1 / years) - 1, 6) if years > 0 else 0.0,
            "trades": len(trades),
            "win_rate": js_round(wins / len(trades), 4) if trades else None,
            "average_trade_return": js_round(mean([trade["return_pct"] for trade in trades]), 6)
            if trades
            else None,
            "max_drawdown": js_round(_max_drawdown([initial_capital, *equities]), 6),
            "benchmark_max_drawdown": js_round(_max_drawdown([initial_capital, *benchmarks]), 6),
            "volatility": js_round(sample_std(strategy_returns) * math.sqrt(TRADING_DAYS_PER_YEAR), 6),
            "sharpe": js_round(sharpe_like_ratio(strategy_returns), 4),
            "benchmark_sharpe": js_round(sharpe_like_ratio(benchmark_returns), 4),
            "exposure": js_round(days_in_market / len(equity_curve), 4) if equity_curve else 0.0,
            "fees_paid": js_round(fees_paid, 2),
            "trading_days": len(equity_curve),
        },
    }


def _format_bps(value: float) -> str:
    """Render like JavaScript's number-to-string (5 → "5", 2.5 → "2.5")."""
    return str(int(value)) if float(value).is_integer() else repr(float(value))
