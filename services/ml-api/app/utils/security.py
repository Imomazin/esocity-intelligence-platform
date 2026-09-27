"""API-key authentication for server-to-server calls from the Esocity web app."""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, status

from app.config import get_settings


async def require_api_key(x_api_key: str | None = Header(default=None, alias="x-api-key")) -> None:
    """Constant-time comparison against ML_API_KEY. A no-op when no key is configured
    (development only — production refuses to start without a key)."""
    configured = get_settings().ML_API_KEY
    if configured is None:
        return
    expected = configured.get_secret_value().encode()
    if x_api_key is None or not hmac.compare_digest(x_api_key.encode(), expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing API key.")
