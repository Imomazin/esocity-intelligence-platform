"""Esocity football model (model key: sports.poisson-dixon-coles). Mirrors lib/sports/football-model.ts.

    λ_home = baseline × √HA × attack*_home × defence*_away × form_home
             × injuryAttack_home × injuryDefence_away × rest_home × restDefence_away
    λ_away = baseline ÷ √HA × attack*_away × defence*_home × form_away
             × injuryAttack_away × injuryDefence_home × rest_away × restDefence_home

attack* / defence* blend the long-run rating (75%) with recent xG relative to the baseline (25%).
Every multiplier is returned in ``factors`` so clients can show the full derivation.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from itertools import pairwise

from app.models.poisson import (
    build_score_matrix,
    clean_sheet_probabilities,
    normalised_entropy,
    outcome_probabilities,
    probability_both_teams_score,
    probability_total_over,
    top_scorelines,
)
from app.utils.numeric import clamp, js_round

FOOTBALL_MODEL_VERSION = "2.1.0"
DEFAULT_RHO = -0.06
DEFAULT_MAX_GOALS = 6

RATING_WEIGHT = 0.75
XG_WEIGHT = 0.25
FORM_WEIGHTS = (0.1, 0.15, 0.2, 0.25, 0.3)  # oldest → most recent (last five)
FORM_POINTS = {"W": 3, "D": 1, "L": 0}
LEAGUE_AVERAGE_PPG = 1.4

INJURY_ATTACK_FACTOR = {"none": 1.0, "minor": 0.98, "moderate": 0.95, "major": 0.9}
#: Applied to the OPPONENT's expected goals (a depleted defence concedes more).
INJURY_DEFENCE_FACTOR = {"none": 1.0, "minor": 1.01, "moderate": 1.03, "major": 1.06}

#: Entropy → uncertainty score knots: (normalised entropy, score). Published thresholds.
UNCERTAINTY_KNOTS = ((0.8, 0.0), (0.88, 25.0), (0.96, 50.0), (0.99, 75.0), (1.0, 100.0))


@dataclass(frozen=True)
class TeamInputs:
    attack: float
    defence: float
    form: tuple[str, ...] = ()
    xg_for: float | None = None
    xg_against: float | None = None
    injuries: str = "none"
    rest_days: int | None = None


@dataclass(frozen=True)
class MatchInputs:
    home: TeamInputs
    away: TeamInputs
    league_baseline_goals: float
    home_advantage: float
    rho: float | None = None
    max_goals: int = DEFAULT_MAX_GOALS


@dataclass
class LambdaFactor:
    key: str
    label: str
    home: float
    away: float
    description: str


@dataclass
class MatchPrediction:
    model_version: str
    lambda_home: float
    lambda_away: float
    max_goals: int
    rho: float
    score_matrix: list[list[float]]
    truncated_mass: float
    outcome: dict[str, float]
    most_likely_outcome: str
    markets: dict[str, float]
    top_scorelines: list[dict[str, float]]
    outcome_entropy: float
    data_quality: float
    confidence: float
    uncertainty: str
    factors: list[LambdaFactor] = field(default_factory=list)


def form_points_per_game(form: tuple[str, ...]) -> float | None:
    """Weighted points-per-game over the last five results (most recent weighted highest)."""
    if not form:
        return None
    recent = form[-len(FORM_WEIGHTS) :]
    weights = FORM_WEIGHTS[len(FORM_WEIGHTS) - len(recent) :]
    weighted = sum(w * FORM_POINTS[r] for w, r in zip(weights, recent, strict=True))
    return weighted / sum(weights)


def form_modifier(form: tuple[str, ...]) -> float:
    """±6% per point-per-game away from the league average, capped at ±8%."""
    ppg = form_points_per_game(form)
    if ppg is None:
        return 1.0
    return clamp(1 + 0.06 * (ppg - LEAGUE_AVERAGE_PPG), 0.92, 1.08)


def rest_modifier(rest_days: int | None) -> float:
    if rest_days is None:
        return 1.0
    if rest_days <= 2:
        return 0.94
    if rest_days == 3:
        return 0.97
    if rest_days >= 7:
        return 1.01
    return 1.0


def _blended_attack(team: TeamInputs, baseline: float) -> float:
    if team.xg_for is None or team.xg_for <= 0:
        return team.attack
    return RATING_WEIGHT * team.attack + XG_WEIGHT * (team.xg_for / baseline)


def _blended_defence(team: TeamInputs, baseline: float) -> float:
    if team.xg_against is None or team.xg_against <= 0:
        return team.defence
    return RATING_WEIGHT * team.defence + XG_WEIGHT * (team.xg_against / baseline)


def data_quality(inputs: MatchInputs) -> float:
    score = 1.0
    for team in (inputs.home, inputs.away):
        if len(team.form) < 3:
            score -= 0.1
        if team.xg_for is None or team.xg_against is None:
            score -= 0.1
        if team.rest_days is None:
            score -= 0.05
        if team.injuries == "moderate":
            score -= 0.05
        if team.injuries == "major":
            score -= 0.1
    return clamp(js_round(score, 3), 0, 1)


def compute_expected_goals(inputs: MatchInputs) -> tuple[float, float, list[LambdaFactor]]:
    home, away = inputs.home, inputs.away
    baseline, home_advantage = inputs.league_baseline_goals, inputs.home_advantage
    if not (baseline > 0 and home_advantage > 0):
        raise ValueError("League baseline goals and home advantage must be positive")
    if not (home.attack > 0 and home.defence > 0 and away.attack > 0 and away.defence > 0):
        raise ValueError("Attack and defence ratings must be positive")

    rest_home = rest_modifier(home.rest_days)
    rest_away = rest_modifier(away.rest_days)
    # Fatigue also loosens a side's defence, at half the attacking effect.
    rest_defence_home = 1 + (1 - rest_home) / 2
    rest_defence_away = 1 + (1 - rest_away) / 2

    factors = [
        LambdaFactor(
            "baseline", "League baseline", baseline, baseline, "League-average goals per team per match."
        ),
        LambdaFactor(
            "home_advantage",
            "Home advantage",
            math.sqrt(home_advantage),
            1 / math.sqrt(home_advantage),
            f"Home/away goal ratio of {home_advantage:.2f} between equal teams, split symmetrically.",
        ),
        LambdaFactor(
            "attack",
            "Attack (rating + xG)",
            _blended_attack(home, baseline),
            _blended_attack(away, baseline),
            "75% long-run attack rating, 25% recent xG relative to the baseline.",
        ),
        LambdaFactor(
            "opponent_defence",
            "Opponent defence",
            _blended_defence(away, baseline),
            _blended_defence(home, baseline),
            "Opponent's defence rating blended with recent xG conceded (lower is stronger).",
        ),
        LambdaFactor(
            "form",
            "Form (last five)",
            form_modifier(home.form),
            form_modifier(away.form),
            "±6% per point-per-game versus league average, capped at ±8%.",
        ),
        LambdaFactor(
            "injuries",
            "Availability",
            INJURY_ATTACK_FACTOR[home.injuries] * INJURY_DEFENCE_FACTOR[away.injuries],
            INJURY_ATTACK_FACTOR[away.injuries] * INJURY_DEFENCE_FACTOR[home.injuries],
            "Own attacking absences reduce output; opponent defensive absences increase it.",
        ),
        LambdaFactor(
            "rest",
            "Rest / fatigue",
            rest_home * rest_defence_away,
            rest_away * rest_defence_home,
            "Short turnarounds (≤3 days) reduce attack and loosen defence.",
        ),
    ]

    lambda_home = 1.0
    lambda_away = 1.0
    for factor in factors:
        lambda_home *= factor.home
        lambda_away *= factor.away

    rounded = [
        LambdaFactor(f.key, f.label, js_round(f.home, 4), js_round(f.away, 4), f.description) for f in factors
    ]
    return clamp(lambda_home, 0.15, 5), clamp(lambda_away, 0.15, 5), rounded


def compute_match_confidence(entropy: float, quality: float) -> float:
    """Concentration of the 1X2 distribution (1 − normalised entropy), adjusted for input
    completeness; capped at 0.9 because football is inherently uncertain."""
    decisiveness = 1 - entropy
    return clamp(js_round((0.35 + 1.6 * decisiveness) * (0.85 + 0.15 * quality), 3), 0, 0.9)


def compute_uncertainty_score(entropy: float, quality: float) -> int:
    base = 0.0
    if entropy >= 1:
        base = 100.0
    elif entropy > UNCERTAINTY_KNOTS[0][0]:
        for (x0, y0), (x1, y1) in pairwise(UNCERTAINTY_KNOTS):
            if entropy <= x1:
                base = y0 + ((entropy - x0) / (x1 - x0)) * (y1 - y0)
                break
    return int(clamp(math.floor(base + 10 * (1 - quality) + 0.5), 0, 100))


def risk_level_from_score(score: float) -> str:
    if score >= 75:
        return "VERY_HIGH"
    if score >= 50:
        return "HIGH"
    if score >= 25:
        return "MODERATE"
    return "LOW"


def _most_likely(home: float, draw: float, away: float) -> str:
    if home >= draw and home >= away:
        return "HOME"
    if away >= draw:
        return "AWAY"
    return "DRAW"


def predict_match(inputs: MatchInputs) -> MatchPrediction:
    max_goals = inputs.max_goals
    lambda_home, lambda_away, factors = compute_expected_goals(inputs)
    matrix = build_score_matrix(
        lambda_home, lambda_away, max_goals=max_goals, rho=DEFAULT_RHO if inputs.rho is None else inputs.rho
    )
    home, draw, away = outcome_probabilities(matrix)
    over15 = probability_total_over(matrix, 1.5)
    over25 = probability_total_over(matrix, 2.5)
    over35 = probability_total_over(matrix, 3.5)
    btts = probability_both_teams_score(matrix)
    clean_home, clean_away = clean_sheet_probabilities(matrix)
    entropy = normalised_entropy([home, draw, away])
    quality = data_quality(inputs)

    return MatchPrediction(
        model_version=FOOTBALL_MODEL_VERSION,
        lambda_home=js_round(lambda_home, 4),
        lambda_away=js_round(lambda_away, 4),
        max_goals=max_goals,
        rho=js_round(matrix.rho, 4),
        score_matrix=matrix.probabilities.tolist(),
        truncated_mass=matrix.truncated_mass,
        outcome={"home": home, "draw": draw, "away": away},
        most_likely_outcome=_most_likely(home, draw, away),
        markets={
            "over_15": over15,
            "over_25": over25,
            "over_35": over35,
            "under_15": 1 - over15,
            "under_25": 1 - over25,
            "under_35": 1 - over35,
            "btts_yes": btts,
            "btts_no": 1 - btts,
            "clean_sheet_home": clean_home,
            "clean_sheet_away": clean_away,
        },
        top_scorelines=[{"home": h, "away": a, "probability": p} for h, a, p in top_scorelines(matrix, 5)],
        outcome_entropy=js_round(entropy, 4),
        data_quality=quality,
        confidence=compute_match_confidence(entropy, quality),
        uncertainty=risk_level_from_score(compute_uncertainty_score(entropy, quality)),
        factors=factors,
    )
