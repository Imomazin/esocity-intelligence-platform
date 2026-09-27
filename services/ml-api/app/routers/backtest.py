from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.schemas.backtest import BacktestRequest, BacktestResponse
from app.services.backtest import BacktestInputError, Bar, run_backtest
from app.utils.security import require_api_key

router = APIRouter(tags=["backtesting"], dependencies=[Depends(require_api_key)])


@router.post("/backtest", response_model=BacktestResponse, summary="Long/flat single-asset backtest")
def backtest_route(request: BacktestRequest) -> BacktestResponse:
    """Signals at the close, execution at the next open, commission and slippage on every fill,
    buy-and-hold benchmark. Identical semantics to the web app's TypeScript engine."""
    bars = [
        Bar(
            date=bar.date.isoformat(),
            open=bar.open,
            high=bar.high,
            low=bar.low,
            close=bar.close,
            volume=bar.volume,
        )
        for bar in request.bars
    ]
    try:
        result = run_backtest(
            bars,
            strategy_id=request.strategy,
            start_date=request.start_date.isoformat(),
            end_date=request.end_date.isoformat(),
            initial_capital=request.initial_capital,
            fee_bps=request.fee_bps,
            slippage_bps=request.slippage_bps,
        )
    except BacktestInputError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
    return BacktestResponse.model_validate(result)
