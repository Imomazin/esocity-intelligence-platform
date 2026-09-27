from __future__ import annotations

import datetime as dt
import math

import pytest

from app.services.backtest import BacktestInputError, Bar, run_backtest


def _bars(n: int = 400) -> list[Bar]:
    """Deterministic series alternating 60-bar up and down phases (so strategies trade)."""
    first_day = dt.date(2020, 1, 1)
    bars: list[Bar] = []
    price = 100.0
    for i in range(n):
        drift = 0.0015 if (i // 60) % 2 == 0 else -0.001
        close = price * math.exp(drift + 0.01 * math.sin(i * 1.7))
        open_ = price * (1 + 0.002 * math.cos(i))
        bars.append(
            Bar(
                date=(first_day + dt.timedelta(days=i)).isoformat(),
                open=open_,
                high=max(open_, close) * 1.004,
                low=min(open_, close) * 0.996,
                close=close,
                volume=1e6,
            )
        )
        price = close
    return bars


def _run(bars: list[Bar], strategy: str = "sma_crossover", **overrides):
    params = {
        "strategy_id": strategy,
        "start_date": bars[120].date,
        "end_date": bars[-1].date,
        "initial_capital": 100_000,
        "fee_bps": 5,
        "slippage_bps": 5,
    }
    params.update(overrides)
    return run_backtest(bars, **params)


@pytest.mark.parametrize("strategy", ["sma_crossover", "momentum", "composite"])
def test_no_look_ahead_truncation_invariance(strategy: str) -> None:
    """Appending future bars must not change any result up to the end date."""
    bars = _bars()
    end = bars[300].date
    truncated = _run(bars[:301], strategy, end_date=end)
    full = _run(bars, strategy, end_date=end)
    assert truncated == full


def test_trades_execute_on_the_bar_after_the_signal() -> None:
    result = _run(_bars())
    assert result["trades"], "expected at least one trade"
    for trade in result["trades"]:
        assert trade["entry_date"] > trade["signal_date"]
        if trade["exit_date"]:
            assert trade["exit_date"] > trade["exit_signal_date"]


def test_costs_reduce_performance() -> None:
    bars = _bars()
    free = _run(bars, fee_bps=0, slippage_bps=0)
    costly = _run(bars, fee_bps=50, slippage_bps=50)
    assert costly["metrics"]["ending_capital"] < free["metrics"]["ending_capital"]
    assert costly["metrics"]["fees_paid"] > 0 == free["metrics"]["fees_paid"]


def test_equity_and_metrics_are_consistent() -> None:
    result = _run(_bars())
    metrics = result["metrics"]
    assert metrics["trading_days"] == len(result["equity_curve"])
    assert metrics["ending_capital"] == result["equity_curve"][-1]["equity"]
    assert -1 <= metrics["max_drawdown"] <= 0
    assert 0 <= metrics["exposure"] <= 1


def test_invalid_requests_raise() -> None:
    bars = _bars()
    with pytest.raises(BacktestInputError):
        _run(bars, strategy="unknown")
    with pytest.raises(BacktestInputError):
        _run(bars, start_date=bars[-1].date, end_date=bars[0].date)
    with pytest.raises(BacktestInputError):
        _run(bars, start_date=bars[-5].date)
