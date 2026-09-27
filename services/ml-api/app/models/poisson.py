"""Poisson score model primitives with the Dixon–Coles low-score correction.

Mirrors lib/sports/poisson.ts. Goals for each side are Poisson(λ); the four low-scoring cells
are adjusted by the Dixon & Coles (1997) τ factor (mass-preserving). The matrix is truncated at
``max_goals`` per side and renormalised so every derived probability sums exactly to 1.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class ScoreMatrix:
    max_goals: int
    probabilities: np.ndarray  # shape (max_goals + 1, max_goals + 1), rows = home goals
    truncated_mass: float
    rho: float


def poisson_pmf(k: int, lam: float) -> float:
    """P(X = k) for X ~ Poisson(λ), computed iteratively for numerical stability."""
    if k < 0:
        return 0.0
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    probability = math.exp(-lam)
    for i in range(1, k + 1):
        probability *= lam / i
    return probability


def poisson_distribution(lam: float, max_goals: int) -> np.ndarray:
    return np.array([poisson_pmf(k, lam) for k in range(max_goals + 1)], dtype=float)


def dixon_coles_tau(
    home_goals: int, away_goals: int, lambda_home: float, lambda_away: float, rho: float
) -> float:
    if home_goals == 0 and away_goals == 0:
        return 1 - lambda_home * lambda_away * rho
    if home_goals == 0 and away_goals == 1:
        return 1 + lambda_home * rho
    if home_goals == 1 and away_goals == 0:
        return 1 + lambda_away * rho
    if home_goals == 1 and away_goals == 1:
        return 1 - rho
    return 1.0


def clamp_rho(rho: float, lambda_home: float, lambda_away: float) -> float:
    """Clamp ρ to the range where every τ stays non-negative."""
    lower = max(-1 / lambda_home, -1 / lambda_away)
    upper = min(1 / (lambda_home * lambda_away), 1)
    return min(upper, max(lower, rho))


def build_score_matrix(
    lambda_home: float, lambda_away: float, max_goals: int = 6, rho: float = 0.0
) -> ScoreMatrix:
    if not (lambda_home > 0 and lambda_away > 0):
        raise ValueError("Expected goals (λ) must be positive")
    rho = clamp_rho(rho, lambda_home, lambda_away)
    raw = np.outer(poisson_distribution(lambda_home, max_goals), poisson_distribution(lambda_away, max_goals))
    for h in (0, 1):
        for a in (0, 1):
            raw[h, a] *= dixon_coles_tau(h, a, lambda_home, lambda_away, rho)
    captured = float(raw.sum())
    return ScoreMatrix(
        max_goals=max_goals,
        probabilities=raw / captured,
        truncated_mass=max(0.0, 1 - captured),
        rho=rho,
    )


def outcome_probabilities(matrix: ScoreMatrix) -> tuple[float, float, float]:
    p = matrix.probabilities
    home = float(np.tril(p, k=-1).sum())  # h > a (below the diagonal)
    draw = float(np.trace(p))
    away = float(np.triu(p, k=1).sum())
    return home, draw, away


def _goal_grid(matrix: ScoreMatrix) -> tuple[np.ndarray, np.ndarray]:
    goals = np.arange(matrix.max_goals + 1)
    return np.meshgrid(goals, goals, indexing="ij")  # (home, away)


def probability_total_over(matrix: ScoreMatrix, line: float) -> float:
    home, away = _goal_grid(matrix)
    return float(matrix.probabilities[(home + away) > line].sum())


def probability_both_teams_score(matrix: ScoreMatrix) -> float:
    return float(matrix.probabilities[1:, 1:].sum())


def clean_sheet_probabilities(matrix: ScoreMatrix) -> tuple[float, float]:
    """(home keeps a clean sheet, away keeps a clean sheet)."""
    return float(matrix.probabilities[:, 0].sum()), float(matrix.probabilities[0, :].sum())


def top_scorelines(matrix: ScoreMatrix, count: int = 5) -> list[tuple[int, int, float]]:
    cells = [
        (h, a, float(matrix.probabilities[h, a]))
        for h in range(matrix.max_goals + 1)
        for a in range(matrix.max_goals + 1)
    ]
    # Highest probability first; ties broken by fewer total goals (matches the TypeScript sort).
    cells.sort(key=lambda cell: (-cell[2], cell[0] + cell[1]))
    return cells[:count]


def normalised_entropy(probabilities: list[float]) -> float:
    n = len(probabilities)
    if n <= 1:
        return 0.0
    entropy = -sum(p * math.log(p) for p in probabilities if p > 0)
    return entropy / math.log(n)
