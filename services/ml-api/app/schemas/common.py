"""Shared wire types. The service speaks snake_case JSON (validated again by lib/ml/contracts.ts)."""

from __future__ import annotations

import datetime as dt
from itertools import pairwise
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

RiskLevel = Literal["LOW", "MODERATE", "HIGH", "VERY_HIGH"]
TradeSignal = Literal["BUY", "HOLD", "SELL"]
MarketRegime = Literal["UPTREND", "DOWNTREND", "RANGE_BOUND", "HIGH_VOLATILITY"]

MAX_BARS = 5_000


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class PriceBar(StrictModel):
    date: dt.date
    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)
    volume: float = Field(ge=0)

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        tolerance = 1e-9 * self.high
        if self.high + tolerance < max(self.open, self.close, self.low) or self.low - tolerance > min(
            self.open, self.close
        ):
            raise ValueError(f"Inconsistent OHLC values on {self.date.isoformat()}")
        return self


def validate_bar_sequence(bars: list[PriceBar]) -> list[PriceBar]:
    """Bars must be strictly increasing by date (no duplicates, no reordering)."""
    for previous, current in pairwise(bars):
        if current.date <= previous.date:
            raise ValueError(
                f"Bars must be sorted by strictly increasing date ({previous.date} → {current.date})."
            )
    return bars
