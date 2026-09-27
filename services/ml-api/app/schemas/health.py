from __future__ import annotations

from app.schemas.common import StrictModel


class ModelInfo(StrictModel):
    key: str
    version: str
    status: str


class HealthResponse(StrictModel):
    status: str
    service: str
    version: str
    xgboost_available: bool
    models: list[ModelInfo]
