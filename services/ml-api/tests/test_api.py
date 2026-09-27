from __future__ import annotations

from fastapi.testclient import TestClient

SPORTS_REQUEST = {
    "home": {
        "attack": 1.2,
        "defence": 0.9,
        "form": ["W", "D", "W"],
        "xg_for": 1.7,
        "xg_against": 1.0,
        "injuries": "none",
        "rest_days": 6,
    },
    "away": {
        "attack": 0.9,
        "defence": 1.1,
        "form": [],
        "xg_for": None,
        "xg_against": None,
        "injuries": "minor",
        "rest_days": None,
    },
    "league_baseline_goals": 1.38,
    "home_advantage": 1.25,
    "rho": None,
    "max_goals": 6,
}


def test_health_is_public_and_versioned(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "esocity-ml-api"
    assert isinstance(body["xgboost_available"], bool)
    assert {model["key"] for model in body["models"]} >= {"sports.poisson-dixon-coles", "ml.gbm-direction"}
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"]


def test_openapi_schema_is_published(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    assert {"/health", "/predict/sports", "/predict/market", "/backtest"} <= set(schema["paths"])


def test_predict_sports(client: TestClient) -> None:
    response = client.post("/predict/sports", json=SPORTS_REQUEST)
    assert response.status_code == 200
    body = response.json()
    outcome = body["outcome"]
    assert abs(outcome["home"] + outcome["draw"] + outcome["away"] - 1) < 1e-9
    assert len(body["score_matrix"]) == 7
    assert body["uncertainty"] in {"LOW", "MODERATE", "HIGH", "VERY_HIGH"}


def test_predict_sports_rejects_invalid_input(client: TestClient) -> None:
    bad = {**SPORTS_REQUEST, "home": {**SPORTS_REQUEST["home"], "attack": -1}}
    assert client.post("/predict/sports", json=bad).status_code == 422
    extra = {**SPORTS_REQUEST, "unexpected": True}
    assert client.post("/predict/sports", json=extra).status_code == 422


def test_predict_market(client: TestClient, parity: dict) -> None:
    case = parity["markets"][0]
    response = client.post(
        "/predict/market", json={"symbol": case["symbol"], "horizon_days": 20, "bars": case["bars"]}
    )
    assert response.status_code == 200
    body = response.json()
    expected = case["expected"]["latest"]
    assert body["composite"]["signal"] == expected["signal"]
    assert body["composite"]["regime"] == expected["regime"]
    assert body["as_of"] == expected["date"]
    assert body["ml"] is not None
    assert 0.02 <= body["ml"]["probability_up"] <= 0.98


def test_predict_market_validates_bars(client: TestClient, parity: dict) -> None:
    bars = parity["markets"][0]["bars"]
    unsorted = [bars[1], bars[0], *bars[2:]]
    assert client.post("/predict/market", json={"symbol": "AAPL", "bars": unsorted}).status_code == 422
    assert client.post("/predict/market", json={"symbol": "AAPL", "bars": bars[:50]}).status_code == 422
    broken = [{**bars[0], "high": bars[0]["low"] * 0.5}, *bars[1:]]
    assert client.post("/predict/market", json={"symbol": "AAPL", "bars": broken}).status_code == 422


def test_backtest_endpoint(client: TestClient, parity: dict) -> None:
    case = parity["backtest"]["cases"][0]
    response = client.post("/backtest", json={**case["request"], "bars": parity["backtest"]["bars"]})
    assert response.status_code == 200
    assert response.json()["metrics"]["trading_days"] == case["expected"]["equity_points"]


def test_backtest_rejects_bad_ranges(client: TestClient, parity: dict) -> None:
    case = parity["backtest"]["cases"][0]
    request = {
        **case["request"],
        "start_date": case["request"]["end_date"],
        "bars": parity["backtest"]["bars"],
    }
    assert client.post("/backtest", json=request).status_code == 422


def test_oversized_bodies_are_rejected(client: TestClient) -> None:
    response = client.post(
        "/predict/sports",
        content=b"{}",
        headers={"content-type": "application/json", "content-length": "99999999"},
    )
    assert response.status_code == 413


def test_api_key_is_enforced_when_configured(secured_client: TestClient) -> None:
    assert secured_client.get("/health").status_code == 200
    assert secured_client.post("/predict/sports", json=SPORTS_REQUEST).status_code == 401
    wrong = secured_client.post(
        "/predict/sports", json=SPORTS_REQUEST, headers={"x-api-key": "wrong-key-000000000"}
    )
    assert wrong.status_code == 401
    ok = secured_client.post(
        "/predict/sports", json=SPORTS_REQUEST, headers={"x-api-key": "test-key-0123456789abcdef"}
    )
    assert ok.status_code == 200
