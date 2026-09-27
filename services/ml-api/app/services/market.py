"""Market prediction: the transparent composite signal plus the gradient-boosted supplement."""

from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict

from app.features.ml_features import build_feature_frame, forward_direction_labels
from app.features.signals import SIGNAL_MODEL_VERSION, build_feature_rows, compute_confidence
from app.models.direction import MIN_TRAINING_SAMPLES, XGBOOST_AVAILABLE, fit_direction_model
from app.schemas.markets import (
    CompositeSummary,
    MarketPredictRequest,
    MarketPredictResponse,
    MlDirectionResult,
)
from app.utils.numeric import js_round


class InsufficientHistoryError(ValueError):
    """Not enough bars to compute the composite signal (maps to HTTP 422)."""


_CACHE_SIZE = 64
_cache: OrderedDict[str, MarketPredictResponse] = OrderedDict()
_cache_lock = threading.Lock()


def _cache_key(request: MarketPredictRequest, seed: int) -> str:
    digest = hashlib.sha256()
    digest.update(f"{request.symbol}|{request.horizon_days}|{seed}|".encode())
    for bar in request.bars:
        digest.update(f"{bar.date.isoformat()},{bar.close!r},{bar.volume!r};".encode())
    return digest.hexdigest()


def predict_market(request: MarketPredictRequest, seed: int = 42) -> MarketPredictResponse:
    key = _cache_key(request, seed)
    with _cache_lock:
        cached = _cache.get(key)
        if cached is not None:
            _cache.move_to_end(key)
            return cached

    dates = [bar.date.isoformat() for bar in request.bars]
    closes = [bar.close for bar in request.bars]
    volumes = [bar.volume for bar in request.bars]
    rows = build_feature_rows(dates, closes, volumes)
    latest = rows[-1]
    if latest.composite is None or latest.scores is None or latest.regime is None or latest.signal is None:
        raise InsufficientHistoryError(f"Insufficient history to compute a signal for {request.symbol}.")

    composite = CompositeSummary(
        signal=latest.signal,  # type: ignore[arg-type]
        score=js_round(latest.composite, 4),
        confidence=compute_confidence(latest.composite, latest.signal, latest.scores, latest.regime),
        regime=latest.regime,  # type: ignore[arg-type]
    )

    notes: list[str] = []
    if not XGBOOST_AVAILABLE:
        notes.append("XGBoost is not installed; the direction model uses scikit-learn HistGradientBoosting.")
    frame = build_feature_frame(rows, closes, volumes)
    labels = forward_direction_labels(closes, request.horizon_days)
    direction = fit_direction_model(frame, labels, request.horizon_days, seed=seed)
    if direction is None:
        notes.append(
            f"Direction model skipped: fewer than {MIN_TRAINING_SAMPLES} labelled observations "
            "or incomplete features on the latest bar."
        )

    response = MarketPredictResponse(
        symbol=request.symbol,
        as_of=latest.date,
        horizon_days=request.horizon_days,
        model_version=SIGNAL_MODEL_VERSION,
        composite=composite,
        ml=None
        if direction is None
        else MlDirectionResult(
            model=direction.model,
            engine=direction.engine,
            probability_up=direction.probability_up,
            cv_auc=direction.cv_auc,
            cv_auc_std=direction.cv_auc_std,
            training_samples=direction.training_samples,
            top_features=direction.top_features,  # type: ignore[arg-type]
        ),
        notes=notes,
    )
    with _cache_lock:
        _cache[key] = response
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
    return response
