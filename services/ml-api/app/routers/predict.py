from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import get_settings
from app.schemas.markets import MarketPredictRequest, MarketPredictResponse
from app.schemas.sports import SportsPredictRequest, SportsPredictResponse
from app.services.market import InsufficientHistoryError, predict_market
from app.services.sports import predict_sports
from app.utils.security import require_api_key

router = APIRouter(prefix="/predict", tags=["predictions"], dependencies=[Depends(require_api_key)])


@router.post(
    "/sports",
    response_model=SportsPredictResponse,
    summary="Football match probabilities (Poisson / Dixon–Coles)",
)
def predict_sports_route(request: SportsPredictRequest) -> SportsPredictResponse:
    """Expected goals, the full renormalised scoreline matrix, 1X2, goals markets, confidence
    and uncertainty. Probabilistic estimates — not guaranteed outcomes."""
    try:
        return predict_sports(request)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error


@router.post(
    "/market",
    response_model=MarketPredictResponse,
    summary="Composite signal plus gradient-boosted direction probability",
)
def predict_market_route(request: MarketPredictRequest) -> MarketPredictResponse:
    """The transparent composite signal for the latest bar and, with enough history, a
    walk-forward-validated gradient-boosted estimate of P(higher close after the horizon)."""
    try:
        return predict_market(request, seed=get_settings().RANDOM_SEED)
    except InsufficientHistoryError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
