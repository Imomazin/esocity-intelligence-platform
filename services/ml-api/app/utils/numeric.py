"""Numeric helpers that mirror the TypeScript engines exactly (see lib/quant/stats.ts)."""

from __future__ import annotations

import math
from collections.abc import Sequence

TRADING_DAYS_PER_YEAR = 252


def js_round(value: float, decimals: int = 4) -> float:
    """Round like JavaScript's ``Math.round(value * 10**d) / 10**d`` (half-up, not banker's)."""
    factor = 10**decimals
    return math.floor(value * factor + 0.5) / factor


def clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def mean(values: Sequence[float]) -> float:
    if not values:
        return math.nan
    return sum(values) / len(values)


def sample_std(values: Sequence[float]) -> float:
    """Sample standard deviation (n − 1 denominator), matching lib/quant/stats.ts stdDev."""
    n = len(values)
    if n < 2:
        return math.nan
    mu = sum(values) / n
    acc = 0.0
    for value in values:
        acc += (value - mu) ** 2
    return math.sqrt(acc / (n - 1))


def sign(value: float) -> float:
    if value > 0:
        return 1.0
    if value < 0:
        return -1.0
    return 0.0


def sharpe_like_ratio(daily_returns: Sequence[float]) -> float:
    """Mean / sample stdev × √252 with a zero risk-free rate (0 when undefined)."""
    if len(daily_returns) < 2:
        return 0.0
    sd = sample_std(daily_returns)
    if not math.isfinite(sd) or sd == 0:
        return 0.0
    return (mean(daily_returns) / sd) * math.sqrt(TRADING_DAYS_PER_YEAR)
