from __future__ import annotations

import datetime as dt
from typing import Literal, Self

from pydantic import Field, model_validator

from app.schemas.common import MAX_BARS, PriceBar, StrictModel, validate_bar_sequence

StrategyId = Literal["sma_crossover", "momentum", "composite"]


class BacktestRequest(StrictModel):
    symbol: str = Field(min_length=1, max_length=12, pattern=r"^[A-Za-z0-9.\-]+$")
    strategy: StrategyId
    start_date: dt.date
    end_date: dt.date
    initial_capital: float = Field(gt=0, le=1_000_000_000)
    fee_bps: float = Field(ge=0, le=500)
    slippage_bps: float = Field(ge=0, le=500)
    bars: list[PriceBar] = Field(min_length=21, max_length=MAX_BARS)

    @model_validator(mode="after")
    def _valid(self) -> Self:
        if self.start_date >= self.end_date:
            raise ValueError("start_date must be before end_date.")
        validate_bar_sequence(self.bars)
        return self


class BacktestMetrics(StrictModel):
    starting_capital: float
    ending_capital: float
    total_return: float
    benchmark_return: float
    excess_return: float
    cagr: float
    trades: int
    win_rate: float | None
    average_trade_return: float | None
    max_drawdown: float
    benchmark_max_drawdown: float
    volatility: float
    sharpe: float
    benchmark_sharpe: float
    exposure: float
    fees_paid: float
    trading_days: int


class EquityPoint(StrictModel):
    date: str
    equity: float
    benchmark: float
    drawdown: float
    exposure: Literal[0, 1]


class BacktestTrade(StrictModel):
    signal_date: str
    entry_date: str
    entry_price: float
    exit_signal_date: str | None
    exit_date: str | None
    exit_price: float | None
    shares: int
    pnl: float
    return_pct: float
    holding_days: int
    open: bool


class BacktestResponse(StrictModel):
    strategy_name: str
    metrics: BacktestMetrics
    equity_curve: list[EquityPoint]
    trades: list[BacktestTrade]
    assumptions: list[str]
    warnings: list[str]
