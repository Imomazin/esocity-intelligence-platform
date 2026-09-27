"""Gradient-boosted direction classifier (model key: ml.gbm-direction, status: development).

Estimates P(close[t + h] > close[t]) from causal technical features. Validation is walk-forward
(scikit-learn ``TimeSeriesSplit`` with a gap equal to the horizon, so overlapping label windows
never straddle a train/test boundary). Uses XGBoost when installed, otherwise scikit-learn's
HistGradientBoostingClassifier.

This model is a research supplement: its output is shown next to — never instead of — the
transparent composite signal, together with its cross-validated AUC.
"""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass

import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import TimeSeriesSplit

MODEL_KEY = "ml.gbm-direction"
MODEL_VERSION = "0.1.0"
MIN_TRAINING_SAMPLES = 250
CV_SPLITS = 5
PROBABILITY_BOUNDS = (0.02, 0.98)

XGBOOST_AVAILABLE = importlib.util.find_spec("xgboost") is not None


@dataclass
class DirectionResult:
    model: str
    engine: str
    probability_up: float
    cv_auc: float | None
    cv_auc_std: float | None
    training_samples: int
    top_features: list[dict[str, float | str]]


def engine_name() -> str:
    if XGBOOST_AVAILABLE:
        import xgboost  # noqa: PLC0415 — optional dependency

        return f"xgboost {xgboost.__version__}"
    return f"scikit-learn {sklearn.__version__} HistGradientBoosting"


def _make_classifier(seed: int):
    if XGBOOST_AVAILABLE:
        from xgboost import XGBClassifier  # noqa: PLC0415 — optional dependency

        return XGBClassifier(
            n_estimators=150,
            max_depth=3,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=5,
            reg_lambda=1.0,
            tree_method="hist",
            eval_metric="logloss",
            random_state=seed,
            n_jobs=1,
        )
    return HistGradientBoostingClassifier(
        max_iter=150,
        max_depth=3,
        learning_rate=0.05,
        l2_regularization=1.0,
        min_samples_leaf=20,
        random_state=seed,
    )


def fit_direction_model(
    features: pd.DataFrame, labels: np.ndarray, horizon: int, seed: int = 42
) -> DirectionResult | None:
    """Walk-forward validate, fit on every labelled row, and predict the latest bar.

    Returns ``None`` when there is not enough labelled history or the latest row is incomplete.
    """
    complete = features.notna().all(axis=1).to_numpy()
    labelled = complete & ~np.isnan(labels)
    latest = features.iloc[[-1]]
    if not complete[-1] or labelled.sum() < MIN_TRAINING_SAMPLES:
        return None

    x = features.loc[labelled].to_numpy()
    y = labels[labelled].astype(int)
    if len(np.unique(y)) < 2:
        return None

    aucs: list[float] = []
    last_fold: tuple[object, np.ndarray, np.ndarray] | None = None
    splitter = TimeSeriesSplit(n_splits=CV_SPLITS, gap=horizon)
    for train_index, test_index in splitter.split(x):
        if len(np.unique(y[train_index])) < 2:
            continue
        fold_model = _make_classifier(seed)
        fold_model.fit(x[train_index], y[train_index])
        if len(np.unique(y[test_index])) == 2:
            aucs.append(float(roc_auc_score(y[test_index], fold_model.predict_proba(x[test_index])[:, 1])))
        last_fold = (fold_model, x[test_index], y[test_index])

    model = _make_classifier(seed)
    model.fit(x, y)
    probability = float(model.predict_proba(latest.to_numpy())[0, 1])
    low, high = PROBABILITY_BOUNDS
    probability = min(high, max(low, probability))

    top_features: list[dict[str, float | str]] = []
    if last_fold is not None:
        fold_model, x_test, y_test = last_fold
        if len(np.unique(y_test)) == 2:
            result = permutation_importance(
                fold_model, x_test, y_test, scoring="neg_log_loss", n_repeats=5, random_state=seed
            )
            importances = np.clip(result.importances_mean, 0, None)
            total = importances.sum()
            if total > 0:
                ranked = sorted(
                    zip(features.columns, importances / total, strict=True), key=lambda item: -item[1]
                )
                top_features = [
                    {"name": name, "importance": round(float(value), 4)}
                    for name, value in ranked[:5]
                    if value > 0
                ]

    return DirectionResult(
        model=f"{MODEL_KEY}@{MODEL_VERSION}",
        engine=engine_name(),
        probability_up=round(probability, 4),
        cv_auc=round(float(np.mean(aucs)), 4) if aucs else None,
        cv_auc_std=round(float(np.std(aucs)), 4) if len(aucs) > 1 else None,
        training_samples=len(y),
        top_features=top_features,
    )
