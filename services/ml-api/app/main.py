"""Esocity ML API — FastAPI application.

Endpoints (OpenAPI schema at /openapi.json, interactive docs at /docs):
  GET  /health            liveness + model inventory (unauthenticated)
  POST /predict/sports    football probabilities
  POST /predict/market    composite signal + gradient-boosted direction model
  POST /backtest          strategy backtest

The Esocity web app never depends on this service: every call has a TypeScript fallback.
"""

from __future__ import annotations

import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app import __version__
from app.config import get_settings
from app.routers import backtest, health, predict


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=settings.LOG_LEVEL.upper(), format="%(levelname)s %(name)s %(message)s")
    logger = logging.getLogger("esocity.ml_api")
    if settings.ML_API_KEY is None:
        logger.warning("ML_API_KEY is not set: prediction endpoints are unauthenticated (development only).")

    app = FastAPI(
        title="Esocity ML API",
        version=__version__,
        summary=(
            "Probabilistic models for Esocity Intelligence. Outputs are estimates, not guaranteed outcomes."
        ),
        docs_url="/docs" if settings.DOCS_ENABLED else None,
        redoc_url=None,
    )

    @app.middleware("http")
    async def guard_and_trace(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                too_large = int(content_length) > settings.MAX_BODY_BYTES
            except ValueError:
                return JSONResponse({"detail": "Invalid Content-Length header."}, status_code=400)
            if too_large:
                return JSONResponse({"detail": "Request body too large."}, status_code=413)
        started = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - started) * 1000
        response.headers["x-request-id"] = request_id
        response.headers["cache-control"] = "no-store"
        response.headers["x-content-type-options"] = "nosniff"
        logger.info(
            "request method=%s path=%s status=%s duration_ms=%.1f request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            request_id,
        )
        return response

    @app.exception_handler(Exception)
    async def unhandled(request: Request, error: Exception) -> JSONResponse:
        logger.exception("unhandled_error path=%s", request.url.path)
        return JSONResponse({"detail": "Internal server error."}, status_code=500)

    app.include_router(health.router)
    app.include_router(predict.router)
    app.include_router(backtest.router)
    return app


app = create_app()
