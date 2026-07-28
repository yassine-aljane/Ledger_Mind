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
    # Step 1 — registry identity (recherche-entreprises)
    siret: str | None = None
    siren: str | None = None
    denomination: str | None = None
    legal_form: str | None = None
    nature_juridique_code: str | None = None
    is_entrepreneur_individuel: bool | None = None
    micro_eligible: bool | None = None
    registry_address: str | None = None
    ape_code: str | None = None  # statistical only — not used for BIC/BNC
    activity_declared: str | None = None
    creation_date: str | None = None
    administrative_status: str | None = None
    verification_status: Literal["verified", "not_verified", "skipped"] | None = None

    # Step 2 — RCS / RNE (auto for companies; document OCR for EI)
    registry_document_required: bool | None = None
    registry_document_uploaded: bool = False
    registry_document_type: Literal["kbis", "rne_extract"] | None = None
    kbis_obtained: bool | None = None  # derived: True if RCS / Kbis
    rcs_registered: bool | None = None
    registry_tax_base: Literal["BIC", "BNC"] | None = None

    # Step 3 — SIRENE avis document (archival proof)
    sirene_document_uploaded: bool = False
    sirene_document_activity_label: str | None = None
    sirene_document_address: str | None = None
    sirene_document_registration_date: str | None = None

    # Profile questions — activity & revenue (steps 4–5 data collection)
    activity_types: list[str] = []
    has_secondary_activity: bool | None = None
    secondary_activity_types: list[str] = []
    main_activity_commercial: bool | None = None  # user self-assessment for step 6
    revenue_sources: list[str] = []
    currencies: list[str] = []
    estimated_monthly_revenue: str | None = None
    estimated_annual_revenue: str | None = None
    revenue_variability: Literal["stable", "spiky", "unknown"] | None = None
    invoices_already_issued: bool | None = None
    first_income_date: str | None = None
    has_recurring_contracts: bool | None = None
    in_kind_gifts: bool | None = None
    international_clients: bool | None = None

    # Tax classification output (steps 4–6)
    tax_category: Literal["BNC", "BIC", "mixed"] | None = None
    tax_category_reason: str | None = None
    recommended_regime: str | None = None
    regime_plafond: str | None = None
    fiscal_classification_status: Literal["confirmed", "inconsistent", "requires_expert"] | None = None
    fiscal_inconsistency_reason: str | None = None

    # Compliance
    activity_mismatch: bool = False
    mismatches: list[Mismatch] = []
    compliance_alerts: list[ComplianceAlert] = []
    recommended_actions: list[RecommendedAction] = []


class OrchestratorState(BaseModel):
    session_id: str
    phase: Literal[
        "verification",
        "verification_registry_document",
        "verification_document",
        "profile_questions",
        "tax_classification",
        "compliance_check",
        "done",
    ]
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
        "show_verification_result",
        "ask_question",
        "upload_registry_document",
        "upload_sirene_document",
        "show_tax_result",
        "show_compliance",
        "done",
        "requires_expert",
    ]
    message: str | None = None
    quick_replies: list[str] = []
    profile: UserProfile
