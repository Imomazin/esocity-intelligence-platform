from __future__ import annotations

from typing import Self

from pydantic import Field, model_validator

from app.schemas.common import (
    MAX_BARS,
    MarketRegime,
    PriceBar,
    StrictModel,
    TradeSignal,
    validate_bar_sequence,
)

MIN_MARKET_BARS = 100


class MarketPredictRequest(StrictModel):
    symbol: str = Field(min_length=1, max_length=12, pattern=r"^[A-Za-z0-9.\-]+$")
    horizon_days: int = Field(default=20, ge=1, le=126)
    bars: list[PriceBar] = Field(min_length=MIN_MARKET_BARS, max_length=MAX_BARS)

    @model_validator(mode="after")
    def _ordered(self) -> Self:
        validate_bar_sequence(self.bars)
        self.symbol = self.symbol.upper()
        return self


class CompositeSummary(StrictModel):
    signal: TradeSignal
    score: float
    confidence: float
    regime: MarketRegime


class FeatureImportance(StrictModel):
    name: str
    importance: float


class MlDirectionResult(StrictModel):
    model: str
    engine: str
    probability_up: float = Field(ge=0, le=1)
    cv_auc: float | None
    cv_auc_std: float | None = None
    training_samples: int
    top_features: list[FeatureImportance]


class MarketPredictResponse(StrictModel):
    symbol: str
    as_of: str
    horizon_days: int
    model_version: str
    composite: CompositeSummary
    ml: MlDirectionResult | None
    notes: list[str] = Field(default_factory=list)
