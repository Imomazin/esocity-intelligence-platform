# Sports engine

Model key `sports.poisson-dixon-coles` v2.1.0 (`lib/sports/*`), ratings `sports.team-ratings` v1.2.0.

## Expected goals

```
λ_home = baseline × √HA × attack*_home × defence*_away × form_home
         × injuryAttack_home × injuryDefence_away × rest_home × restDefence_away
λ_away = baseline ÷ √HA × attack*_away × defence*_home × form_away
         × injuryAttack_away × injuryDefence_home × rest_away × restDefence_home
```

- **baseline** — league-average goals per team per match; **HA** — home/away goal ratio between
  equal teams, split symmetrically so the baseline is preserved.
- **attack\*/defence\*** — 75% long-run rating + 25% recent xG ÷ baseline (when xG is known).
- **form** — weighted points per game over the last five (weights 0.1…0.3), ±6% per PPG vs 1.4,
  capped at ±8%.
- **availability** — own attacking absences ×0.98/0.95/0.90; opponent defensive absences
  ×1.01/1.03/1.06 (minor/moderate/major).
- **rest** — ≤2 days ×0.94, 3 days ×0.97, ≥7 days ×1.01; fatigue also loosens defence at half
  the effect. λ is clamped to [0.15, 5]. Every factor is displayed on the match page.

## Score distribution

Independent Poisson(λ) goals with the **Dixon–Coles τ correction** for 0-0, 1-0, 0-1, 1-1
(ρ default −0.06, clamped so every τ ≥ 0; mass-preserving). The 0–6 × 0–6 matrix is
**renormalised** so all derived probabilities sum to exactly 1; the truncated tail mass is
reported. Derived: home/draw/away, over/under 1.5/2.5/3.5, BTTS yes/no, clean sheets, top five
scorelines.

## Confidence and uncertainty

- Data quality starts at 1 and loses points for missing form, xG, rest data and for injuries.
- Confidence = (0.35 + 1.6 × (1 − H)) × (0.85 + 0.15 × quality), capped at 0.9, where H is the
  normalised entropy of the 1X2 distribution.
- Uncertainty score: piecewise-linear in H through (0.80, 0) (0.88, 25) (0.96, 50) (0.99, 75)
  (1.0, 100), plus up to 10 points for incomplete inputs → LOW / MODERATE / HIGH / VERY HIGH.

## Ratings

Maher-style multiplicative attack/defence ratings estimated by iterative proportional fitting
with Gamma–Poisson priors (prior weight 6 matches). League baseline and home advantage use
pseudo-match priors (40 and 200 matches) — home advantage is stable and hard to overturn.
Pre-match inputs for each fixture are built **only from results before kick-off**
(walk-forward), so historical predictions never see their own outcome (tested).

## Demo universe

Two fictional competitions (Premier Division, Continental League), 22 fictional clubs, a rolling
double round-robin season with balanced home/away sequences, midweek fixtures and injuries.
Fictional names prevent synthetic output being mistaken for real fixtures.

## Evaluation

Multiclass Brier score vs base rates (H 0.45 / D 0.26 / A 0.29), log loss, 1X2 accuracy,
over-2.5 Brier vs 0.52 base rate, BTTS Brier, reliability bins — live in the Model Lab.

## Licensed data (`SPORTS_DATA_PROVIDER=api-football`)

Fixtures, 90-minute results, expected goals and availability are ingested from API-Football into
PostgreSQL ([DATA_PIPELINE.md](DATA_PIPELINE.md)). `StoredSportsDataProvider` rebuilds every
pre-match input with the same engines, walk-forward on real fixture times
(`lib/sports/walk-forward.ts`):

- **Information set** — a fixture sees only results final before its kick-off (kick-off +
  110 minutes); an early kick-off can inform a later one on the same day. Tested for look-ahead:
  changing a result never changes the inputs of that fixture or any earlier one.
- **Priors** — last season's ratings regressed toward average (prior = rating^0.7); promoted
  clubs start from the average of the clubs they replaced; league baseline and home advantage
  from last season's estimates. Without a stored previous season, priors are neutral.
- **Form, xG, table** — last five results; mean xG for/against over those matches where the
  provider has xG; league position before kick-off.
- **Rest** — days since the club's previous league fixture. Cup and European fixtures are not
  ingested, so rest can be overstated around congested periods.
- **Availability** — players ruled out count 1, doubtful 0.5: < 1 none, < 3 minor, < 6
  moderate, otherwise major (count-based; player importance is not modelled).

## Adding a provider

Implement a `FootballSource` (`lib/sports/ingestion.ts`) on top of `ProviderHttpClient`, map
fixtures, results, xG and availability into the stored shape, wire it into
`lib/ingestion/service.ts`, and serve it with `StoredSportsDataProvider` (SportMonks and Opta
placeholders are registered).

Sports probabilities are analytical estimates. **Esocity does not offer betting or wagering.**
