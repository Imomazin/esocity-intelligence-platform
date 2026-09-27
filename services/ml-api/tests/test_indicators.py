from __future__ import annotations

import math

import pytest

from app.features.indicators import (
    drawdown_series,
    ema,
    macd,
    rate_of_change,
    rolling_percentile_rank,
    rolling_volatility,
    rsi,
    sma,
    trend_strength,
)


def _prices(n: int = 300) -> list[float]:
    # Deterministic, gently trending, noisy series.
    return [
        100 * math.exp(0.0005 * i + 0.02 * math.sin(i / 3.0) + 0.01 * math.cos(i / 7.0)) for i in range(n)
    ]


def test_sma_and_ema_known_values() -> None:
    values = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert sma(values, 3) == [None, None, 2.0, 3.0, 4.0]
    out = ema(values, 3)
    assert out[:2] == [None, None]
    assert out[2] == pytest.approx(2.0)  # seeded with the SMA
    assert out[3] == pytest.approx(0.5 * 4 + 0.5 * 2.0)


def test_rsi_extremes_and_bounds() -> None:
    rising = [float(i) for i in range(1, 40)]
    assert rsi(rising)[-1] == 100
    flat = [10.0] * 40
    assert rsi(flat)[-1] == 50
    values = [v for v in rsi(_prices()) if v is not None]
    assert all(0 <= v <= 100 for v in values)
    assert rsi(rising, 14)[13] is None and rsi(rising, 14)[14] is not None


def test_macd_histogram_is_line_minus_signal() -> None:
    line, signal, histogram = macd(_prices())
    for value, s, h in zip(line, signal, histogram, strict=True):
        if h is not None:
            assert h == pytest.approx(value - s)


def test_rolling_volatility_is_zero_for_constant_growth() -> None:
    closes = [100 * 1.001**i for i in range(80)]
    vol = rolling_volatility(closes, 20)
    assert vol[19] is None
    assert vol[20] == pytest.approx(0, abs=1e-9)


def test_drawdown_is_non_positive() -> None:
    assert all(value <= 0 for value in drawdown_series(_prices()))
    assert drawdown_series([1.0, 2.0, 1.0]) == [0.0, 0.0, -0.5]


def test_trend_strength_sign_follows_direction() -> None:
    up = [100 * math.exp(0.002 * i + 0.003 * math.sin(i)) for i in range(120)]
    down = list(reversed(up))
    assert trend_strength(up)[-1] > 0.5
    assert trend_strength(down)[-1] < -0.5


def test_percentile_rank_requires_min_samples() -> None:
    series = [float(i) for i in range(100)]
    ranks = rolling_percentile_rank(series, lookback=252, min_samples=60)
    assert ranks[58] is None
    assert ranks[99] == pytest.approx((99 + 0.5) / 100)


@pytest.mark.parametrize(
    "indicator",
    [
        lambda c: sma(c, 20),
        lambda c: ema(c, 20),
        lambda c: rsi(c, 14),
        lambda c: macd(c)[2],
        lambda c: rate_of_change(c, 21),
        lambda c: rolling_volatility(c, 20),
        lambda c: trend_strength(c, 50),
    ],
)
def test_indicators_are_causal(indicator) -> None:
    """Values up to t must not change when later bars are appended (no look-ahead)."""
    closes = _prices(260)
    full = indicator(closes)
    for cut in (80, 150, 220):
        truncated = indicator(closes[:cut])
        assert truncated == full[:cut]
