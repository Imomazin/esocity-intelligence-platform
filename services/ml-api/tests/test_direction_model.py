from __future__ import annotations

import numpy as np
import pandas as pd

from app.features.ml_features import FEATURE_NAMES, build_feature_frame, forward_direction_labels
from app.features.signals import build_feature_rows
from app.models.direction import MIN_TRAINING_SAMPLES, fit_direction_model


def test_forward_labels_never_use_unknown_future() -> None:
    closes = [1.0, 2.0, 1.5, 1.0, 2.0]
    labels = forward_direction_labels(closes, 2)
    assert labels[:3].tolist() == [1.0, 0.0, 1.0]
    assert np.isnan(labels[3:]).all()


def test_returns_none_without_enough_history() -> None:
    frame = pd.DataFrame(np.random.default_rng(0).normal(size=(100, 3)), columns=["a", "b", "c"])
    labels = (np.random.default_rng(1).random(100) > 0.5).astype(float)
    assert fit_direction_model(frame, labels, horizon=5) is None


def test_recovers_a_planted_signal() -> None:
    """When one feature determines the label, walk-forward AUC is high and it ranks first."""
    rng = np.random.default_rng(7)
    n = 600
    frame = pd.DataFrame(rng.normal(size=(n, 4)), columns=["signal", "noise_1", "noise_2", "noise_3"])
    labels = (frame["signal"].to_numpy() + 0.3 * rng.normal(size=n) > 0).astype(float)
    labels[-5:] = np.nan  # unknown future
    result = fit_direction_model(frame, labels, horizon=5, seed=42)
    assert result is not None
    assert result.cv_auc is not None and result.cv_auc > 0.85
    assert result.top_features[0]["name"] == "signal"
    assert 0.02 <= result.probability_up <= 0.98
    assert result.training_samples == n - 5


def test_noise_gives_uninformative_auc() -> None:
    rng = np.random.default_rng(3)
    n = 600
    frame = pd.DataFrame(rng.normal(size=(n, 5)), columns=list("abcde"))
    labels = (rng.random(n) > 0.5).astype(float)
    result = fit_direction_model(frame, labels, horizon=5, seed=42)
    assert result is not None
    assert result.cv_auc is not None and abs(result.cv_auc - 0.5) < 0.12


def test_feature_frame_from_prices(parity: dict) -> None:
    bars = parity["markets"][0]["bars"]
    closes = [bar["close"] for bar in bars]
    volumes = [bar["volume"] for bar in bars]
    rows = build_feature_rows([bar["date"] for bar in bars], closes, volumes)
    frame = build_feature_frame(rows, closes, volumes)
    assert list(frame.columns) == FEATURE_NAMES
    assert frame.iloc[-1].notna().all()
    labels = forward_direction_labels(closes, 20)
    result = fit_direction_model(frame, labels, horizon=20)
    assert result is not None
    assert result.training_samples >= MIN_TRAINING_SAMPLES
