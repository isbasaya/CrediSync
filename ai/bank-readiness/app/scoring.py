"""
Bank-readiness scoring — v1 weighted-feature model.

This is a documented, auditable rules-based scorer, not a trained ML
model: CrediSync has no historical labelled outcome data (did this
consumer's bank application actually succeed?) yet to train on. Every
weight and threshold below is a product/risk decision, not a learned
parameter, and is deliberately kept in one place so it can be tuned or
swapped for a trained model later without touching the API contract in
schemas.py or main.py. `model_version` lets consumers of this API detect
when the underlying methodology changes.
"""
from .schemas import BankReadinessInput, BankReadinessResult, BankReadinessTier, FactorBreakdown

MODEL_VERSION = "rules-v1.1"

WEIGHTS = {
    "credit_score": 0.35,
    "adverse_history": 0.20,
    "affordability": 0.15,
    "surplus": 0.10,
    "income_stability": 0.10,
    "account_conduct": 0.10,
}
if abs(sum(WEIGHTS.values()) - 1.0) > 1e-9:  # explicit check: asserts vanish under python -O
    raise RuntimeError("bank-readiness WEIGHTS must sum to 1.0")

TIER_THRESHOLDS: list[tuple[float, BankReadinessTier]] = [
    (75.0, BankReadinessTier.prime),
    (55.0, BankReadinessTier.near_prime),
    (35.0, BankReadinessTier.sub_prime),
]

REASON_MESSAGES = {
    "credit_score": "Unified bureau score is limiting bank readiness",
    "adverse_history": "Judgements, defaults, or adverse accounts on file",
    "affordability": "Debt-to-income ratio is high relative to lender norms",
    "surplus": "Monthly surplus after committed expenses is thin",
    "income_stability": "Income deposits are irregular month to month",
    "account_conduct": "Recent overdraft days or returned debit orders",
}


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _linear(value: float, low: float, high: float, invert: bool = False) -> float:
    """Maps value in [low, high] to a 0-100 subscore. invert=True means lower input is better."""
    if high == low:
        return 50.0
    ratio = (value - low) / (high - low)
    ratio = max(0.0, min(1.0, ratio))
    subscore = ratio * 100.0
    return 100.0 - subscore if invert else subscore


def _credit_score_subscore(unified_score: int | None) -> float:
    if unified_score is None:
        return 0.0  # no bureau data at all is the strongest negative signal
    return _linear(unified_score, 0, 999)


def _adverse_history_subscore(judgements: int, defaults: int, adverse_accounts: int) -> float:
    double_counted = min(adverse_accounts, judgements + defaults)
    other_adverse = max(0, adverse_accounts - double_counted)
    penalty = judgements * 30 + defaults * 20 + other_adverse * 8
    return _clamp(100 - penalty)


def _affordability_subscore(dti: float | None) -> float:
    if dti is None:
        return 50.0  # unknown; neutral rather than penalised
    return _linear(dti, 0.20, 0.60, invert=True)


def _surplus_subscore(affordability_surplus: float | None, net_income: float) -> float:
    if affordability_surplus is None:
        return 50.0
    if net_income <= 0:
        return 100.0 if affordability_surplus > 0 else 0.0
    ratio = affordability_surplus / net_income
    return _linear(ratio, 0.0, 0.30)


def _income_stability_subscore(income_regularity_score: float | None) -> float:
    if income_regularity_score is None:
        return 50.0
    return _clamp(income_regularity_score * 100.0)


def _account_conduct_subscore(overdraft_days_30d: int, returned_debit_count: int) -> float:
    penalty = overdraft_days_30d * 4 + returned_debit_count * 15
    return _clamp(100 - penalty)


def _tier_for(score: float) -> BankReadinessTier:
    for threshold, tier in TIER_THRESHOLDS:
        if score >= threshold:
            return tier
    return BankReadinessTier.unqualified


def compute_bank_readiness(features: BankReadinessInput) -> BankReadinessResult:
    raw_subscores = {
        "credit_score": _credit_score_subscore(features.unified_score),
        "adverse_history": _adverse_history_subscore(
            features.judgements_count, features.defaults_count, features.adverse_accounts
        ),
        "affordability": _affordability_subscore(features.debt_to_income_ratio),
        "surplus": _surplus_subscore(features.affordability_surplus, features.net_income),
        "income_stability": _income_stability_subscore(features.income_regularity_score),
        "account_conduct": _account_conduct_subscore(features.overdraft_days_30d, features.returned_debit_count),
    }

    breakdown: dict[str, FactorBreakdown] = {}
    total_score = 0.0
    for factor, weight in WEIGHTS.items():
        raw = raw_subscores[factor]
        contribution = raw * weight
        total_score += contribution
        breakdown[factor] = FactorBreakdown(weight=weight, raw_subscore=round(raw, 2), weighted_contribution=round(contribution, 2))

    total_score = round(_clamp(total_score), 2)

    # Worst-performing factors (lowest raw subscore) explain the score,
    # weighted by how much they actually dragged the total down.
    weakest_factors = sorted(breakdown.items(), key=lambda kv: kv[1].raw_subscore)
    top_reasons = [REASON_MESSAGES[factor] for factor, fb in weakest_factors if fb.raw_subscore < 70][:3]
    if not top_reasons:
        top_reasons = ["No significant risk factors identified"]

    return BankReadinessResult(
        score=total_score,
        tier=_tier_for(total_score),
        breakdown=breakdown,
        top_reasons=top_reasons,
        model_version=MODEL_VERSION,
    )
