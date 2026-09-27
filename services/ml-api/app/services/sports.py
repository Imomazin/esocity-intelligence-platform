"""Adapter between the sports wire schema and the football model."""

from __future__ import annotations

from dataclasses import asdict

from app.models.football import MatchInputs, TeamInputs, predict_match
from app.schemas.sports import SportsPredictRequest, SportsPredictResponse
from app.schemas.sports import TeamInputs as TeamInputsSchema


def _team(team: TeamInputsSchema) -> TeamInputs:
    return TeamInputs(
        attack=team.attack,
        defence=team.defence,
        form=tuple(team.form),
        xg_for=team.xg_for,
        xg_against=team.xg_against,
        injuries=team.injuries,
        rest_days=team.rest_days,
    )


def predict_sports(request: SportsPredictRequest) -> SportsPredictResponse:
    prediction = predict_match(
        MatchInputs(
            home=_team(request.home),
            away=_team(request.away),
            league_baseline_goals=request.league_baseline_goals,
            home_advantage=request.home_advantage,
            rho=request.rho,
            max_goals=request.max_goals,
        )
    )
    return SportsPredictResponse.model_validate(asdict(prediction))
