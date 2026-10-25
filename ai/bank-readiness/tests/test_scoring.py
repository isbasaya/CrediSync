import os

os.environ.setdefault("NODE_ENV", "test")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.schemas import BankReadinessInput, BankReadinessTier  # noqa: E402
from app.scoring import compute_bank_readiness  # noqa: E402
from app.security import internal_service_token  # noqa: E402

client = TestClient(app)
AUTH = {"X-Internal-Token": internal_service_token()}

STRONG = {
    "unified_score": 780,
    "adverse_accounts": 0,
    "judgements_count": 0,
    "defaults_count": 0,
    "enquiries_last_12m": 1,
    "total_credit_exposure": 120000,
    "monthly_instalment": 3000,
    "net_income": 35000,
    "debt_to_income_ratio": 0.15,
    "savings_rate": 0.1,
    "income_regularity_score": 0.95,
    "affordability_surplus": 12000,
    "overdraft_days_30d": 0,
    "returned_debit_count": 0,
}


def test_rejects_calls_without_the_gateway_token():
    assert client.post("/score", json=STRONG).status_code == 401
    assert client.post("/score", json=STRONG, headers={"X-Internal-Token": "wrong"}).status_code == 401


def test_scores_a_strong_profile_as_prime():
    res = client.post("/score", json=STRONG, headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    assert body["tier"] == "prime"
    assert 0 <= body["score"] <= 100
    assert body["model_version"] == "rules-v1.1"


def test_judgements_and_returned_debits_pull_the_score_down_and_explain_why():
    weak = {**STRONG, "judgements_count": 2, "returned_debit_count": 3, "overdraft_days_30d": 12}
    result = compute_bank_readiness(BankReadinessInput(**weak))
    assert result.tier in (BankReadinessTier.sub_prime, BankReadinessTier.near_prime, BankReadinessTier.unqualified)
    assert any("Judgements" in r for r in result.top_reasons)


def test_no_bureau_data_is_the_strongest_negative_signal():
    result = compute_bank_readiness(BankReadinessInput(**{**STRONG, "unified_score": None}))
    assert result.breakdown["credit_score"].raw_subscore == 0


def test_rejects_unknown_fields_and_out_of_range_values():
    assert client.post("/score", json={**STRONG, "is_admin": True}, headers=AUTH).status_code == 422
    assert client.post("/score", json={**STRONG, "unified_score": 1200}, headers=AUTH).status_code == 422


def test_docs_are_not_exposed():
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_requires_the_secret_outside_development(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.delenv("INTERNAL_SERVICE_TOKEN", raising=False)
    with pytest.raises(RuntimeError):
        internal_service_token()
