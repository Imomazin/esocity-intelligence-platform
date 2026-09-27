from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas.common import RiskLevel, StrictModel

FormResult = Literal["W", "D", "L"]
InjuryLevel = Literal["none", "minor", "moderate", "major"]


class TeamInputs(StrictModel):
    attack: float = Field(gt=0, le=5, description="Multiplicative attack rating (1.0 = league average).")
    defence: float = Field(gt=0, le=5, description="Multiplicative defence rating (lower concedes less).")
    form: list[FormResult] = Field(default_factory=list, max_length=20, description="Oldest → most recent.")
    xg_for: float | None = Field(default=None, ge=0, le=10)
    xg_against: float | None = Field(default=None, ge=0, le=10)
    injuries: InjuryLevel = "none"
    rest_days: int | None = Field(default=None, ge=0, le=365)


class SportsPredictRequest(StrictModel):
    home: TeamInputs
    away: TeamInputs
    league_baseline_goals: float = Field(gt=0, le=6, description="League-average goals per team per match.")
    home_advantage: float = Field(gt=0.5, le=3, description="Home/away expected-goals ratio for equal teams.")
    rho: float | None = Field(default=None, ge=-0.5, le=0.5, description="Dixon–Coles dependence parameter.")
    max_goals: int = Field(default=6, ge=4, le=12)


class Outcome(StrictModel):
    home: float
    draw: float
    away: float


class GoalMarkets(StrictModel):
    over_15: float
    over_25: float
    over_35: float
    under_15: float
    under_25: float
    under_35: float
    btts_yes: float
    btts_no: float
    clean_sheet_home: float
    clean_sheet_away: float


class Scoreline(StrictModel):
    home: int
    away: int
    probability: float


class LambdaFactor(StrictModel):
    key: str
    label: str
    home: float
    away: float
    description: str


class SportsPredictResponse(StrictModel):
    model_version: str
    lambda_home: float
    lambda_away: float
    max_goals: int
    rho: float
    score_matrix: list[list[float]]
    truncated_mass: float
    outcome: Outcome
    most_likely_outcome: Literal["HOME", "DRAW", "AWAY"]
    markets: GoalMarkets
    top_scorelines: list[Scoreline]
    outcome_entropy: float
    data_quality: float
    confidence: float
    uncertainty: RiskLevel
    factors: list[LambdaFactor]
