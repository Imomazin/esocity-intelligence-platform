"""Causal technical indicators. Mirrors lib/markets/indicators.ts.

Every function returns a list aligned 1:1 with its input; warm-up positions are ``None``. The
value at index t depends only on inputs[0..t] — the backtester relies on this (tested).
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from app.utils.numeric import TRADING_DAYS_PER_YEAR, sample_std

Series = list[float | None]


def simple_returns(closes: Sequence[float]) -> Series:
    return [None if i == 0 else closes[i] / closes[i - 1] - 1 for i in range(len(closes))]


def log_returns(closes: Sequence[float]) -> Series:
    return [None if i == 0 else math.log(closes[i] / closes[i - 1]) for i in range(len(closes))]


def sma(values: Sequence[float], period: int) -> Series:
    if period < 1:
        raise ValueError("SMA period must be >= 1")
    out: Series = [None] * len(values)
    window_sum = 0.0
    for i, value in enumerate(values):
        window_sum += value
        if i >= period:
            window_sum -= values[i - period]
        if i >= period - 1:
            out[i] = window_sum / period
    return out


def ema(values: Sequence[float], period: int) -> Series:
    """EMA with α = 2 / (period + 1), seeded with the SMA of the first ``period`` values."""
    if period < 1:
        raise ValueError("EMA period must be >= 1")
    out: Series = [None] * len(values)
    if len(values) < period:
        return out
    alpha = 2 / (period + 1)
    seed = 0.0
    for i in range(period):
        seed += values[i]
    previous = seed / period
    out[period - 1] = previous
    for i in range(period, len(values)):
        previous = alpha * values[i] + (1 - alpha) * previous
        out[i] = previous
    return out


def _ema_of_series(series: Series, period: int) -> Series:
    out: Series = [None] * len(series)
    first = next((i for i, value in enumerate(series) if value is not None), -1)
    if first < 0:
        return out
    tail = [float(value) for value in series[first:]]  # type: ignore[arg-type]
    for offset, value in enumerate(ema(tail, period)):
        out[first + offset] = value
    return out


def _rsi_from_averages(average_gain: float, average_loss: float) -> float:
    if average_loss == 0:
        return 50.0 if average_gain == 0 else 100.0
    return 100 - 100 / (1 + average_gain / average_loss)


def rsi(closes: Sequence[float], period: int = 14) -> Series:
    """Wilder's RSI: simple mean of the first ``period`` changes, then Wilder smoothing."""
    out: Series = [None] * len(closes)
    if len(closes) <= period:
        return out
    gain_sum = 0.0
    loss_sum = 0.0
    for i in range(1, period + 1):
        change = closes[i] - closes[i - 1]
        if change > 0:
            gain_sum += change
        else:
            loss_sum -= change
    average_gain = gain_sum / period
    average_loss = loss_sum / period
    out[period] = _rsi_from_averages(average_gain, average_loss)
    for i in range(period + 1, len(closes)):
        change = closes[i] - closes[i - 1]
        gain = change if change > 0 else 0.0
        loss = -change if change < 0 else 0.0
        average_gain = (average_gain * (period - 1) + gain) / period
        average_loss = (average_loss * (period - 1) + loss) / period
        out[i] = _rsi_from_averages(average_gain, average_loss)
    return out


def macd(
    closes: Sequence[float], fast: int = 12, slow: int = 26, signal_period: int = 9
) -> tuple[Series, Series, Series]:
    fast_ema = ema(closes, fast)
    slow_ema = ema(closes, slow)
    line: Series = [
        None if f is None or s is None else f - s for f, s in zip(fast_ema, slow_ema, strict=True)
    ]
    signal = _ema_of_series(line, signal_period)
    histogram: Series = [
        None if value is None or s is None else value - s for value, s in zip(line, signal, strict=True)
    ]
    return line, signal, histogram


def rate_of_change(closes: Sequence[float], period: int) -> Series:
    return [None if i < period else closes[i] / closes[i - period] - 1 for i in range(len(closes))]


def rolling_volatility(closes: Sequence[float], window: int = 20) -> Series:
    """Annualised sample stdev of daily log returns over ``window`` returns."""
    returns = log_returns(closes)
    out: Series = [None] * len(closes)
    for i in range(window, len(closes)):
        segment = [float(r) for r in returns[i - window + 1 : i + 1]]  # type: ignore[arg-type]
        out[i] = sample_std(segment) * math.sqrt(TRADING_DAYS_PER_YEAR)
    return out


def drawdown_series(closes: Sequence[float]) -> list[float]:
    peak = -math.inf
    out: list[float] = []
    for close in closes:
        peak = max(peak, close)
        out.append(close / peak - 1)
    return out


def _linear_regression(values: Sequence[float]) -> tuple[float, float]:
    """OLS slope and R² of ``values`` against x = 0..n−1."""
    n = len(values)
    x_mean = (n - 1) / 2
    y_mean = sum(values) / n
    sxy = sxx = syy = 0.0
    for i, value in enumerate(values):
        dx = i - x_mean
        dy = value - y_mean
        sxy += dx * dy
        sxx += dx * dx
        syy += dy * dy
    slope = sxy / sxx
    r_squared = 0.0 if syy == 0 else (sxy * sxy) / (sxx * syy)
    return slope, r_squared


def trend_strength(closes: Sequence[float], window: int = 50) -> Series:
    """tanh((annualised OLS slope of log price ÷ annualised volatility) × R²) over ``window`` bars."""
    out: Series = [None] * len(closes)
    if len(closes) < window:
        return out
    logs = [math.log(close) for close in closes]
    for i in range(window - 1, len(closes)):
        segment = logs[i - window + 1 : i + 1]
        slope, r_squared = _linear_regression(segment)
        daily = [segment[k + 1] - segment[k] for k in range(len(segment) - 1)]
        volatility = sample_std(daily) * math.sqrt(TRADING_DAYS_PER_YEAR)
        if not math.isfinite(volatility) or volatility == 0:
            out[i] = 0.0
            continue
        out[i] = math.tanh((slope * TRADING_DAYS_PER_YEAR / volatility) * r_squared)
    return out


def rolling_percentile_rank(series: Series, lookback: int = 252, min_samples: int = 60) -> Series:
    """Mid-rank percentile of each value within its trailing ``lookback`` window (inclusive)."""
    out: Series = [None] * len(series)
    for i, value in enumerate(series):
        if value is None:
            continue
        count = below = equal = 0
        for j in range(max(0, i - lookback + 1), i + 1):
            entry = series[j]
            if entry is None:
                continue
            count += 1
            if entry < value:
                below += 1
            elif entry == value:
                equal += 1
        if count >= min_samples:
            out[i] = (below + 0.5 * equal) / count
    return out
