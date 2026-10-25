from fastapi import FastAPI

from .schemas import BankReadinessInput, BankReadinessResult
from .scoring import compute_bank_readiness

app = FastAPI(
    title="CrediSync Bank-Readiness Scoring Service",
    version="0.1.0",
    description="Predicts a consumer's readiness for mainstream bank credit products from their unified "
    "credit profile and open-banking financial health snapshot.",
)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/score", response_model=BankReadinessResult)
def score(features: BankReadinessInput) -> BankReadinessResult:
    """
    Computes a 0-100 bank-readiness score and tier from the caller-supplied
    credit profile + financial health features. Stateless — the API
    gateway is responsible for fetching the latest credit_profiles /
    financial_health_snapshots rows and persisting bank_readiness_score /
    bank_readiness_tier back onto credit_profiles after calling this.
    """
    return compute_bank_readiness(features)
