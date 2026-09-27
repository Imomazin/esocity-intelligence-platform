"""Service configuration, read from environment variables (never from source code)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", case_sensitive=True)

    #: "production" makes the API key mandatory (the service refuses to start without it).
    ESOCITY_ENV: Literal["development", "test", "production"] = "development"
    #: Shared secret expected in the ``x-api-key`` header. Minimum 16 characters when set.
    ML_API_KEY: SecretStr | None = None
    LOG_LEVEL: Literal["debug", "info", "warning", "error"] = "info"
    #: Reject request bodies larger than this (bytes). 5,000 daily bars ≈ 0.6 MB of JSON.
    MAX_BODY_BYTES: int = Field(default=2_000_000, ge=10_000, le=20_000_000)
    #: Serve interactive OpenAPI docs at /docs (the schema at /openapi.json is always served).
    DOCS_ENABLED: bool = True
    #: Seed for every stochastic learner so results are reproducible.
    RANDOM_SEED: int = 42

    @model_validator(mode="after")
    def _validate_security(self) -> Settings:
        key = self.ML_API_KEY.get_secret_value() if self.ML_API_KEY else ""
        if key and len(key) < 16:
            raise ValueError("ML_API_KEY must be at least 16 characters.")
        if self.ESOCITY_ENV == "production" and not key:
            raise ValueError("ML_API_KEY is required when ESOCITY_ENV=production.")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
