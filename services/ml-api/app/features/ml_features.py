"""Feature matrix and labels for the gradient-boosted direction model.

All features are causal (row t uses bars[0..t] only). The label for row t is whether the close
``horizon`` bars later is higher — so the most recent ``horizon`` rows are unlabelled and are
never used for training.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import pandas as pd

from app.features.indicators import rate_of_change, sma
from app.features.signals import FeatureRow

FEATURE_NAMES = [
    "return_1d",
    "return_5d",
    "momentum_21d",
    "momentum_63d",
    "rsi_14",
    "macd_histogram_pct",
    "distance_sma20",
    "distance_sma50",
    "volatility_20d",
    "volatility_percentile",
    "trend_strength",
    "drawdown",
    "composite_score",
    "volume_ratio",
]


def build_feature_frame(
    rows: Sequence[FeatureRow], closes: Sequence[float], volumes: Sequence[float]
) -> pd.DataFrame:
    """One row per bar with every model feature (NaN during indicator warm-up)."""
    roc5 = rate_of_change(closes, 5)
    volume_avg = sma(volumes, 20)

    def ratio(numerator: float | None, denominator: float | None) -> float:
        if numerator is None or denominator is None or denominator == 0:
            return np.nan
        return numerator / denominator - 1

    records = []
    for row, r5, v_avg in zip(rows, roc5, volume_avg, strict=True):
        records.append(
            {
                "date": row.date,
                "return_1d": row.return1d,
                "return_5d": r5,
                "momentum_21d": row.momentum21,
                "momentum_63d": row.momentum63,
                "rsi_14": None if row.rsi14 is None else row.rsi14 / 100,
                "macd_histogram_pct": None if row.macd_histogram is None else row.macd_histogram / row.close,
                "distance_sma20": ratio(row.close, row.sma20),
                "distance_sma50": ratio(row.close, row.sma50),
                "volatility_20d": row.volatility20,
                "volatility_percentile": row.volatility_percentile,
                "trend_strength": row.trend_strength,
                "drawdown": row.drawdown,
                "composite_score": row.composite,
                "volume_ratio": ratio(row.volume, v_avg),
            }
        )
    frame = pd.DataFrame.from_records(records).set_index("date")
    return frame[FEATURE_NAMES].astype(float)


def forward_direction_labels(closes: Sequence[float], horizon: int) -> np.ndarray:
    """y_t = 1 if close[t + horizon] > close[t]; NaN where the future is not yet known."""
    values = np.asarray(closes, dtype=float)
    labels = np.full(values.shape, np.nan)
    if len(values) > horizon:
        labels[:-horizon] = (values[horizon:] > values[:-horizon]).astype(float)
    return labels
