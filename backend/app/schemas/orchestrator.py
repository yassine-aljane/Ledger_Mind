from pydantic import BaseModel
from typing import Literal


class Mismatch(BaseModel):
    field: str
    declared_value: str | None = None
    actual_value: str | None = None
    note: str


class ComplianceAlert(BaseModel):
    severity: Literal["info", "warning", "critical"]
    message: str


class RecommendedAction(BaseModel):
    step: int
    title: str
    description: str


class UserProfile(BaseModel):
    # From verification
    siret: str | None = None
    siren: str | None = None
    denomination: str | None = None
    legal_form: str | None = None
    ape_code: str | None = None
    activity_declared: str | None = None
    creation_date: str | None = None
    administrative_status: str | None = None
    verification_status: Literal["verified", "not_verified", "skipped"] | None = None

    # From profile questions (same fields as InfluencerProfile)
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

    # From tax classification
    tax_category: Literal["BNC", "BIC", "mixed"] | None = None
    tax_category_reason: str | None = None
    recommended_regime: str | None = None
    regime_plafond: str | None = None

    # From compliance check
    activity_mismatch: bool = False
    mismatches: list[Mismatch] = []
    compliance_alerts: list[ComplianceAlert] = []
    recommended_actions: list[RecommendedAction] = []


class OrchestratorState(BaseModel):
    session_id: str
    phase: Literal["verification", "profile_questions", "tax_classification", "compliance_check", "done"]
    profile: UserProfile
    skip_verification: bool = False
    last_question: str | None = None
    quick_replies: list[str] = []
    profile_completeness: float = 0.0
    verification_message: str | None = None


class OrchestratorStartRequest(BaseModel):
    siret: str | None = None
    company_name: str | None = None


class OrchestratorTurnRequest(BaseModel):
    session_id: str
    user_answer: str | None = None


class OrchestratorTurnResponse(BaseModel):
    session_id: str
    phase: str
    ui_action: Literal[
        "show_verification_result", "ask_question", "show_tax_result",
        "show_compliance", "done"
    ]
    message: str | None = None
    quick_replies: list[str] = []
    profile: UserProfile
