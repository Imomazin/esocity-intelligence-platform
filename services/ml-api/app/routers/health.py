from __future__ import annotations

from fastapi import APIRouter

from app import __version__
from app.features.signals import SIGNAL_MODEL_VERSION
from app.models.direction import MODEL_KEY, MODEL_VERSION, XGBOOST_AVAILABLE
from app.models.football import FOOTBALL_MODEL_VERSION
from app.schemas.health import HealthResponse, ModelInfo

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse, summary="Liveness and model inventory")
def health() -> HealthResponse:
    """Unauthenticated liveness probe. Exposes versions only — never configuration or secrets."""
    return HealthResponse(
        status="ok",
        service="esocity-ml-api",
        version=__version__,
        xgboost_available=XGBOOST_AVAILABLE,
        models=[
            ModelInfo(key="sports.poisson-dixon-coles", version=FOOTBALL_MODEL_VERSION, status="production"),
            ModelInfo(key="markets.composite-signal", version=SIGNAL_MODEL_VERSION, status="production"),
            ModelInfo(key=MODEL_KEY, version=MODEL_VERSION, status="development"),
        ],
    )
