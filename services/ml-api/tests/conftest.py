from __future__ import annotations

import json
import os
from collections.abc import Iterator
from pathlib import Path

import pytest

os.environ.setdefault("ESOCITY_ENV", "test")
os.environ.pop("ML_API_KEY", None)

from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def parity() -> dict:
    return json.loads((FIXTURES / "parity.json").read_text())


@pytest.fixture
def client() -> Iterator[TestClient]:
    get_settings.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    get_settings.cache_clear()


@pytest.fixture
def secured_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("ML_API_KEY", "test-key-0123456789abcdef")
    get_settings.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client
    monkeypatch.delenv("ML_API_KEY")
    get_settings.cache_clear()
