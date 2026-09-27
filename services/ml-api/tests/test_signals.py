from __future__ import annotations

import math

import pytest

from app.features.signals import (
    build_feature_rows,
    classify_regime,
    composite_score,
    compute_confidence,
    decide_signal,
    score_momentum,
    score_rsi,
    score_trend,
    score_volatility,
)


def test_component_scores_are_bounded() -> None:
    for value in range(0, 101, 5):
        assert -1 <= score_rsi(float(value)) <= 1
    for p in (0, 0.25, 0.5, 0.75, 1):
        assert -1 <= score_volatility(p) <= 0.5
    assert -1 <= score_trend(110, 105, 100, 0.9) <= 1
    assert -1 < score_momentum(0.4, 0.8, 0.2) < 1


def test_rsi_score_reverses_beyond_bands() -> None:
    assert score_rsi(60) > 0
    assert score_rsi(90) < score_rsi(70)
    assert score_rsi(10) > score_rsi(30)


def test_decision_thresholds() -> None:
    assert decide_signal(0.25) == "BUY"
    assert decide_signal(0.2499) == "HOLD"
    assert decide_signal(-0.25) == "SELL"


def test_regime_rules_in_order() -> None:
    assert classify_regime(110, 105, 100, 0.5, 0.95) == "HIGH_VOLATILITY"
    assert classify_regime(110, 105, 100, 0.5, 0.5) == "UPTREND"
    assert classify_regime(90, 95, 100, -0.5, 0.5) == "DOWNTREND"
    assert classify_regime(101, 99, 100, 0.05, 0.5) == "RANGE_BOUND"


def test_composite_and_confidence_ranges() -> None:
    scores = {"trend": 0.8, "momentum": 0.6, "rsi": 0.2, "volatility": 0.1, "regime": 0.8}
    score = composite_score(scores)
    assert score == pytest.approx(0.3 * 0.8 + 0.25 * 0.6 + 0.15 * 0.2 + 0.1 * 0.1 + 0.2 * 0.8)
    confidence = compute_confidence(score, decide_signal(score), scores, "UPTREND")
    assert 0.05 <= confidence <= 0.95
    hold = compute_confidence(0.0, "HOLD", dict.fromkeys(scores, 0.0), "RANGE_BOUND")
    assert hold <= 0.8  # a HOLD never earns top-tier conviction


def test_feature_rows_warm_up_then_score() -> None:
    closes = [100 * math.exp(0.001 * i + 0.02 * math.sin(i / 4)) for i in range(200)]
    rows = build_feature_rows([f"d{i}" for i in range(200)], closes, [1_000_000.0] * 200)
    assert rows[50].composite is None
    assert rows[-1].composite is not None
    assert rows[-1].signal in {"BUY", "HOLD", "SELL"}
