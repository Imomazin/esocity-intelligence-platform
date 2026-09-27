from __future__ import annotations

import math

import numpy as np
import pytest

from app.models.poisson import (
    build_score_matrix,
    clamp_rho,
    clean_sheet_probabilities,
    dixon_coles_tau,
    normalised_entropy,
    outcome_probabilities,
    poisson_pmf,
    probability_both_teams_score,
    probability_total_over,
    top_scorelines,
)


def test_poisson_pmf_matches_closed_form() -> None:
    for lam in (0.3, 1.4, 3.2):
        for k in range(8):
            expected = math.exp(-lam) * lam**k / math.factorial(k)
            assert poisson_pmf(k, lam) == pytest.approx(expected, rel=1e-12)
    assert poisson_pmf(-1, 1.0) == 0
    assert poisson_pmf(0, 0) == 1


def test_score_matrix_is_normalised_and_reports_truncation() -> None:
    matrix = build_score_matrix(1.6, 1.1, max_goals=6, rho=-0.06)
    assert matrix.probabilities.shape == (7, 7)
    assert matrix.probabilities.sum() == pytest.approx(1, abs=1e-12)
    assert (matrix.probabilities >= 0).all()
    assert 0 < matrix.truncated_mass < 0.01


def test_dixon_coles_adjustment_preserves_total_mass() -> None:
    lam_h, lam_a, rho = 1.3, 0.9, -0.1
    base = sum(poisson_pmf(h, lam_h) * poisson_pmf(a, lam_a) for h in (0, 1) for a in (0, 1))
    adjusted = sum(
        poisson_pmf(h, lam_h) * poisson_pmf(a, lam_a) * dixon_coles_tau(h, a, lam_h, lam_a, rho)
        for h in (0, 1)
        for a in (0, 1)
    )
    assert adjusted == pytest.approx(base, rel=1e-12)


def test_negative_rho_inflates_draws() -> None:
    independent = outcome_probabilities(build_score_matrix(1.2, 1.2, rho=0))
    dependent = outcome_probabilities(build_score_matrix(1.2, 1.2, rho=-0.1))
    assert dependent[1] > independent[1]


def test_rho_is_clamped_to_valid_range() -> None:
    assert clamp_rho(-5, 1.5, 1.2) == pytest.approx(-1 / 1.5)
    assert clamp_rho(5, 1.5, 1.2) == pytest.approx(min(1 / (1.5 * 1.2), 1))


def test_derived_markets_are_coherent() -> None:
    matrix = build_score_matrix(1.45, 1.05, rho=-0.06)
    home, draw, away = outcome_probabilities(matrix)
    assert home + draw + away == pytest.approx(1, abs=1e-12)
    over = probability_total_over(matrix, 2.5)
    assert 0 < over < 1
    btts = probability_both_teams_score(matrix)
    clean_home, clean_away = clean_sheet_probabilities(matrix)
    # P(BTTS) = 1 − P(home scores 0) − P(away scores 0) + P(0-0)
    p00 = float(matrix.probabilities[0, 0])
    assert btts == pytest.approx(1 - clean_home - clean_away + p00, abs=1e-12)


def test_top_scorelines_are_sorted_descending() -> None:
    lines = top_scorelines(build_score_matrix(1.4, 1.0), 5)
    probabilities = [p for _, _, p in lines]
    assert probabilities == sorted(probabilities, reverse=True)
    assert len(lines) == 5


def test_invalid_lambdas_raise() -> None:
    with pytest.raises(ValueError, match="positive"):
        build_score_matrix(0, 1.0)


def test_normalised_entropy_bounds() -> None:
    assert normalised_entropy([1 / 3, 1 / 3, 1 / 3]) == pytest.approx(1)
    assert normalised_entropy([1, 0, 0]) == 0
    assert 0 < normalised_entropy(list(np.array([0.6, 0.25, 0.15]))) < 1
