"""
Pydantic schemas for the bank-readiness scoring service.

Field names mirror the relevant columns in db/schema.sql's
`credit_profiles` and `financial_health_snapshots` tables so the API
gateway can forward those rows with minimal transformation.
"""
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class BankReadinessTier(str, Enum):
    prime = "prime"
    near_prime = "near_prime"
    sub_prime = "sub_prime"
    unqualified = "unqualified"


class BankReadinessInput(BaseModel):
    # From credit_profiles
    unified_score: Optional[int] = Field(None, ge=0, le=999)
    adverse_accounts: int = Field(0, ge=0)
    judgements_count: int = Field(0, ge=0)
    defaults_count: int = Field(0, ge=0)
    enquiries_last_12m: int = Field(0, ge=0)
    total_credit_exposure: float = Field(0, ge=0)
    monthly_instalment: float = Field(0, ge=0)

    # From financial_health_snapshots (most recent snapshot)
    net_income: float = Field(0, ge=0)
    debt_to_income_ratio: Optional[float] = Field(None, ge=0)
    savings_rate: Optional[float] = None
    income_regularity_score: Optional[float] = Field(None, ge=0, le=1)
    affordability_surplus: Optional[float] = None
    overdraft_days_30d: int = Field(0, ge=0, le=30)
    returned_debit_count: int = Field(0, ge=0)


class FactorBreakdown(BaseModel):
    weight: float
    raw_subscore: float = Field(..., description="0-100 subscore for this factor before weighting")
    weighted_contribution: float


class BankReadinessResult(BaseModel):
    score: float = Field(..., ge=0, le=100)
    tier: BankReadinessTier
    breakdown: dict[str, FactorBreakdown]
    top_reasons: list[str] = Field(..., description="Plain-language factors most responsible for the score, worst-first")
    model_version: str
