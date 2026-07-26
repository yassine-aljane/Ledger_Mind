from pydantic import BaseModel
from typing import Literal


class InfluencerProfile(BaseModel):
    activity_types: list[str] = []
    revenue_sources: list[str] = []
    currencies: list[str] = []
    estimated_monthly_revenue: str | None = None
    revenue_variability: Literal["stable", "spiky", "unknown"] | None = None
    invoices_already_issued: bool | None = None
    first_income_date: str | None = None
    has_recurring_contracts: bool | None = None
    in_kind_gifts: bool | None = None
    international_clients: bool | None = None


class OnboardingTurnRequest(BaseModel):
    profile: InfluencerProfile
    last_question: str | None = None
    last_answer: str | None = None


class OnboardingTurnResult(BaseModel):
    profile: InfluencerProfile
    next_question: str | None = None
    quick_replies: list[str] = []
    is_done: bool
    completeness: float
