from fastapi import Depends, FastAPI

from .schemas import BankReadinessInput, BankReadinessResult
from .scoring import compute_bank_readiness
from .security import internal_service_token, require_internal_token

# Fail at start-up, not on the first request, if the secret is missing.
internal_service_token()

app = FastAPI(
    title="CrediSync Bank-Readiness Scoring Service",
    version="0.2.0",
    description="Scores a consumer's readiness for mainstream bank credit from their unified credit profile "
    "and open-banking snapshot. Internal service: called only by the API gateway.",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/score", response_model=BankReadinessResult, dependencies=[Depends(require_internal_token)])
def score(features: BankReadinessInput) -> BankReadinessResult:
    """
    Computes a 0-100 bank-readiness score and tier. Stateless: the gateway
    builds the features from stored data (never from client input) and
    persists the result onto credit_profiles.
    """
    return compute_bank_readiness(features)
