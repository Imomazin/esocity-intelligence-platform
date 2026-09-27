"""Esocity composite market signal (model key: markets.composite-signal). Mirrors
lib/markets/signal-engine.ts and lib/markets/regime.ts.

    score = Σ weight_k × component_k,  each component ∈ [−1, 1]
    BUY if score ≥ +0.25 · SELL if score ≤ −0.25 · HOLD otherwise
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from app.features.indicators import (
    drawdown_series,
    ema,
    macd,
    rate_of_change,
    rolling_percentile_rank,
    rolling_volatility,
    rsi,
    simple_returns,
    sma,
    trend_strength,
)
from app.utils.numeric import clamp, js_round, sign

SIGNAL_MODEL_VERSION = "1.3.0"
SIGNAL_HORIZON_DAYS = 20

SIGNAL_WEIGHTS = {"trend": 0.3, "momentum": 0.25, "rsi": 0.15, "volatility": 0.1, "regime": 0.2}
SIGNAL_THRESHOLDS = {"buy": 0.25, "sell": -0.25}
REGIME_SCORES = {"UPTREND": 0.8, "DOWNTREND": -0.8, "RANGE_BOUND": 0.0, "HIGH_VOLATILITY": -0.5}
HIGH_VOLATILITY_PERCENTILE = 0.9
TREND_STRENGTH_THRESHOLD = 0.15


def classify_regime(
    close: float, sma20: float, sma50: float, strength: float, volatility_percentile: float
) -> str:
    if volatility_percentile >= HIGH_VOLATILITY_PERCENTILE:
        return "HIGH_VOLATILITY"
    if close > sma50 and sma20 > sma50 and strength > TREND_STRENGTH_THRESHOLD:
        return "UPTREND"
    if close < sma50 and sma20 < sma50 and strength < -TREND_STRENGTH_THRESHOLD:
        return "DOWNTREND"
    return "RANGE_BOUND"


def score_trend(close: float, sma20: float, sma50: float, strength: float) -> float:
    alignment = (sign(close - sma20) + sign(sma20 - sma50) + sign(close - sma50)) / 3
    return clamp(0.6 * strength + 0.4 * alignment, -1, 1)


def score_momentum(momentum21: float, momentum63: float, volatility63: float) -> float:
    vol = max(volatility63, 0.05)
    z63 = momentum63 / (vol * math.sqrt(63 / 252))
    z21 = momentum21 / (vol * math.sqrt(21 / 252))
    return math.tanh((0.7 * z63 + 0.3 * z21) / 1.5)


def score_rsi(value: float) -> float:
    confirmation = (0.5 * (value - 50)) / 50
    overbought = (1.5 * max(0.0, value - 70)) / 30
    oversold = (1.5 * max(0.0, 30 - value)) / 30
    return clamp(confirmation - overbought + oversold, -1, 1)


def score_volatility(percentile: float) -> float:
    p = clamp(percentile, 0, 1)
    return 0.5 - p if p <= 0.5 else -2 * (p - 0.5)


def composite_score(scores: dict[str, float]) -> float:
    total = 0.0
    for key, weight in SIGNAL_WEIGHTS.items():
        total += weight * scores[key]
    return clamp(total, -1, 1)


def decide_signal(score: float) -> str:
    if score >= SIGNAL_THRESHOLDS["buy"]:
        return "BUY"
    if score <= SIGNAL_THRESHOLDS["sell"]:
        return "SELL"
    return "HOLD"


def compute_confidence(score: float, signal: str, scores: dict[str, float], regime: str) -> float:
    threshold = SIGNAL_THRESHOLDS["buy"]
    magnitude = abs(score)
    if signal == "HOLD":
        decisiveness = 0.5 + 0.3 * clamp((threshold - magnitude) / threshold, 0, 1) ** 0.7
    else:
        decisiveness = 0.5 + 0.5 * clamp((magnitude - threshold) / 0.5, 0, 1) ** 0.7
    supporting = 0.0
    total = 0.0
    for key, weight in SIGNAL_WEIGHTS.items():
        component = scores[key]
        total += weight
        supports = abs(component) < 0.35 if signal == "HOLD" else component * sign(score) > 0.05
        if supports:
            supporting += weight
    agreement = supporting / total
    penalty = 0.85 if regime == "HIGH_VOLATILITY" else 1.0
    return clamp(js_round(decisiveness * (0.55 + 0.45 * agreement) * penalty, 3), 0.05, 0.95)


@dataclass
class FeatureRow:
    index: int
    date: str
    close: float
    volume: float
    return1d: float | None
    sma20: float | None
    sma50: float | None
    ema20: float | None
    rsi14: float | None
    macd: float | None
    macd_signal: float | None
    macd_histogram: float | None
    momentum21: float | None
    momentum63: float | None
    volatility20: float | None
    volatility63: float | None
    volatility_percentile: float | None
    trend_strength: float | None
    drawdown: float
    regime: str | None = None
    scores: dict[str, float] | None = None
    composite: float | None = None
    signal: str | None = None


def build_feature_rows(
    dates: Sequence[str], closes: Sequence[float], volumes: Sequence[float]
) -> list[FeatureRow]:
    """Every feature for every bar, computed causally (row t uses bars[0..t] only)."""
    sma20 = sma(closes, 20)
    sma50 = sma(closes, 50)
    ema20 = ema(closes, 20)
    rsi14 = rsi(closes, 14)
    macd_line, macd_signal, macd_hist = macd(closes)
    momentum21 = rate_of_change(closes, 21)
    momentum63 = rate_of_change(closes, 63)
    volatility20 = rolling_volatility(closes, 20)
    volatility63 = rolling_volatility(closes, 63)
    volatility_percentile = rolling_percentile_rank(volatility20, 252, 60)
    strength = trend_strength(closes, 50)
    drawdown = drawdown_series(closes)
    returns = simple_returns(closes)

    rows: list[FeatureRow] = []
    for i in range(len(closes)):
        row = FeatureRow(
            index=i,
            date=dates[i],
            close=closes[i],
            volume=volumes[i],
            return1d=returns[i],
            sma20=sma20[i],
            sma50=sma50[i],
            ema20=ema20[i],
            rsi14=rsi14[i],
            macd=macd_line[i],
            macd_signal=macd_signal[i],
            macd_histogram=macd_hist[i],
            momentum21=momentum21[i],
            momentum63=momentum63[i],
            volatility20=volatility20[i],
            volatility63=volatility63[i],
            volatility_percentile=volatility_percentile[i],
            trend_strength=strength[i],
            drawdown=drawdown[i],
        )
        if (
            row.sma20 is not None
            and row.sma50 is not None
            and row.rsi14 is not None
            and row.momentum21 is not None
            and row.momentum63 is not None
            and row.volatility63 is not None
            and row.volatility_percentile is not None
            and row.trend_strength is not None
        ):
            regime = classify_regime(
                row.close, row.sma20, row.sma50, row.trend_strength, row.volatility_percentile
            )
            scores = {
                "trend": score_trend(row.close, row.sma20, row.sma50, row.trend_strength),
                "momentum": score_momentum(row.momentum21, row.momentum63, row.volatility63),
                "rsi": score_rsi(row.rsi14),
                "volatility": score_volatility(row.volatility_percentile),
                "regime": REGIME_SCORES[regime],
            }
            composite = composite_score(scores)
            row.regime = regime
            row.scores = scores
            row.composite = composite
            row.signal = decide_signal(composite)
        rows.append(row)
    return rows
