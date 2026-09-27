from __future__ import annotations

import pytest

from app.models.football import (
    MatchInputs,
    TeamInputs,
    compute_expected_goals,
    compute_uncertainty_score,
    form_modifier,
    predict_match,
    rest_modifier,
)


def _inputs(**overrides) -> MatchInputs:
    base = {
        "home": TeamInputs(
            attack=1.1, defence=0.95, form=("W", "D", "W"), xg_for=1.6, xg_against=1.1, rest_days=6
        ),
        "away": TeamInputs(
            attack=0.95, defence=1.05, form=("L", "D", "W"), xg_for=1.2, xg_against=1.4, rest_days=6
        ),
        "league_baseline_goals": 1.38,
        "home_advantage": 1.25,
    }
    base.update(overrides)
    return MatchInputs(**base)


def test_probabilities_sum_to_one() -> None:
    prediction = predict_match(_inputs())
    outcome = prediction.outcome
    assert outcome["home"] + outcome["draw"] + outcome["away"] == pytest.approx(1, abs=1e-12)
    total = sum(sum(row) for row in prediction.score_matrix)
    assert total == pytest.approx(1, abs=1e-12)
    markets = prediction.markets
    assert markets["over_25"] + markets["under_25"] == pytest.approx(1, abs=1e-12)
    assert markets["btts_yes"] + markets["btts_no"] == pytest.approx(1, abs=1e-12)


def test_home_advantage_favours_the_home_side() -> None:
    equal = TeamInputs(attack=1.0, defence=1.0)
    neutral = predict_match(_inputs(home=equal, away=equal, home_advantage=1.0))
    home_edge = predict_match(_inputs(home=equal, away=equal, home_advantage=1.3))
    assert neutral.outcome["home"] == pytest.approx(neutral.outcome["away"], abs=1e-12)
    assert home_edge.outcome["home"] > home_edge.outcome["away"]


def test_injuries_and_fatigue_reduce_expected_goals() -> None:
    fit_home, _, _ = compute_expected_goals(_inputs())
    injured = _inputs(home=TeamInputs(attack=1.1, defence=0.95, injuries="major", rest_days=2))
    injured_home, _, _ = compute_expected_goals(injured)
    assert injured_home < fit_home


def test_form_and_rest_modifiers_are_bounded() -> None:
    assert form_modifier(("W",) * 5) == pytest.approx(1.08)
    assert form_modifier(("L",) * 5) == pytest.approx(0.92)
    assert form_modifier(()) == 1
    assert rest_modifier(None) == 1
    assert rest_modifier(2) < rest_modifier(3) < rest_modifier(5) < rest_modifier(8)


def test_confidence_is_capped_and_uncertainty_graded() -> None:
    strong = predict_match(
        _inputs(home=TeamInputs(attack=2.2, defence=0.6), away=TeamInputs(attack=0.6, defence=1.8))
    )
    assert strong.confidence <= 0.9
    assert strong.uncertainty in {"LOW", "MODERATE"}
    even = predict_match(_inputs(home=TeamInputs(attack=1, defence=1), away=TeamInputs(attack=1, defence=1)))
    assert even.uncertainty in {"HIGH", "VERY_HIGH"}
    assert compute_uncertainty_score(1.0, 1.0) == 100
    assert compute_uncertainty_score(0.5, 1.0) == 0


def test_factors_explain_lambda() -> None:
    lam_home, lam_away, factors = compute_expected_goals(_inputs())
    product_home = 1.0
    product_away = 1.0
    for factor in factors:
        product_home *= factor.home
        product_away *= factor.away
    # Factors are rounded to 4 dp for display; their product stays within rounding error.
    assert product_home == pytest.approx(lam_home, rel=1e-3)
    assert product_away == pytest.approx(lam_away, rel=1e-3)


def test_invalid_inputs_raise() -> None:
    with pytest.raises(ValueError, match="positive"):
        compute_expected_goals(_inputs(league_baseline_goals=0))
