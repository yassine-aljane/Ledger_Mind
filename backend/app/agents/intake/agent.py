"""
Intake agent public API (branch A).

Verification (steps 1–3): SIREN identity → RCS doc OCR (EI) → SIRENE avis upload.
Profiling (steps 4–5): activity, mixed activity, revenue data for VAT tracking.
Finalize (step 6): BIC/BNC/mixed classification + inconsistency handling.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.agents.intake.questions import (
    completeness_ratio,
    generate_question_for_field,
    next_missing_field,
)
from app.agents.intake.tools.check_compliance import check_compliance
from app.agents.intake.tools.classify_tax import classify_tax_category
from app.agents.intake.tools.verification import run_verification_service
from app.agents.intake.understand import understand_answer
from app.schemas.orchestrator import UserProfile
from app.schemas.verification import VerificationResult
from app.services.ocr_registry_doc import RegistryDocData
from app.services.ocr_sirene_avis import SireneAvisData

logger = logging.getLogger(__name__)

REGISTRY_DOC_MESSAGE = (
    "Étape 2 — Déposez votre Kbis (greffe / RCS) ou votre extrait RNE (INPI). "
    "Nous détectons automatiquement votre inscription RCS (BIC) ou RNE seul (BNC)."
)

SIRENE_UPLOAD_MESSAGE = (
    "Étape 3 — Téléchargez votre avis de situation SIRENE (PDF gratuit sur "
    "avis-situation-sirene.insee.fr). Ce document sera archivé comme preuve "
    "de référence en cas de contrôle."
)


@dataclass
class IntakeQuestionResult:
    profile: UserProfile
    question: str | None
    quick_replies: list[str]
    completeness: float
    is_complete: bool


def finalize_profile(profile: UserProfile) -> UserProfile:
    category, reason, regime, plafond, fiscal_status = classify_tax_category(profile)

    if fiscal_status == "requires_expert":
        profile.fiscal_classification_status = "requires_expert"
        profile.fiscal_inconsistency_reason = reason
        profile.tax_category_reason = reason
    elif category:
        profile.tax_category = category  # type: ignore[assignment]
        profile.tax_category_reason = reason
        profile.recommended_regime = regime
        profile.regime_plafond = plafond
        profile.fiscal_classification_status = "confirmed"

    activity_mismatch, mismatches, alerts, actions = check_compliance(profile)
    profile.activity_mismatch = activity_mismatch
    profile.mismatches = mismatches
    profile.compliance_alerts = alerts
    profile.recommended_actions = actions
    return profile


def verification_context(profile: UserProfile) -> dict | None:
    ctx: dict = {}
    if profile.denomination:
        ctx["denomination"] = profile.denomination
    if profile.ape_code:
        ctx["ape_code"] = profile.ape_code
    if profile.registry_tax_base:
        ctx["registry_tax_base"] = profile.registry_tax_base
    if profile.legal_form:
        ctx["legal_form"] = profile.legal_form
    return ctx or None


def apply_verification_to_profile(profile: UserProfile, result: VerificationResult) -> UserProfile:
    identifier = (result.siret or "").replace(" ", "")
    if len(identifier) == 14:
        profile.siret = identifier
        profile.siren = identifier[:9]
    elif len(identifier) == 9:
        profile.siren = identifier
        profile.siret = None

    profile.denomination = result.denomination
    profile.legal_form = result.legal_form
    profile.nature_juridique_code = result.nature_juridique_code
    profile.is_entrepreneur_individuel = result.is_entrepreneur_individuel
    profile.micro_eligible = result.micro_eligible
    profile.registry_address = result.registry_address
    profile.ape_code = result.ape_code
    profile.activity_declared = result.activity_declared
    profile.creation_date = result.creation_date
    profile.administrative_status = result.administrative_status
    profile.verification_status = result.status
    profile.registry_document_required = result.registry_document_required
    profile.rcs_registered = result.rcs_registered
    profile.registry_tax_base = result.registry_tax_base
    if result.rcs_registered is not None:
        profile.kbis_obtained = result.rcs_registered
    return profile


def apply_registry_document(profile: UserProfile, doc: RegistryDocData) -> UserProfile:
    profile.registry_document_uploaded = True
    profile.registry_document_type = doc.document_type
    profile.rcs_registered = doc.document_type == "kbis"
    profile.kbis_obtained = profile.rcs_registered
    profile.registry_tax_base = "BIC" if profile.rcs_registered else "BNC"
    if doc.siren and profile.siren and doc.siren != profile.siren.replace(" ", ""):
        logger.warning(
            "Registry doc SIREN %s does not match profile SIREN %s",
            doc.siren,
            profile.siren,
        )
    return profile


def apply_sirene_document(profile: UserProfile, doc: SireneAvisData) -> UserProfile:
    profile.sirene_document_uploaded = True
    profile.sirene_document_activity_label = doc.activity_label
    profile.sirene_document_address = doc.address
    profile.sirene_document_registration_date = doc.registration_date
    if doc.siren and not profile.siren:
        profile.siren = doc.siren
    return profile


async def run_verification(siret: str, company_name: str | None = None) -> VerificationResult:
    return await run_verification_service(siret, company_name)


async def ask_next_question(
    profile: UserProfile,
    *,
    preface: str | None = None,
) -> IntakeQuestionResult:
    missing = next_missing_field(profile)
    if missing is None:
        profile = finalize_profile(profile)
        return IntakeQuestionResult(
            profile=profile,
            question=None,
            quick_replies=[],
            completeness=1.0,
            is_complete=True,
        )

    question, quick_replies = await generate_question_for_field(
        profile,
        missing,
        verification_context=verification_context(profile),
        preface=preface,
    )
    return IntakeQuestionResult(
        profile=profile,
        question=question,
        quick_replies=quick_replies,
        completeness=completeness_ratio(profile),
        is_complete=False,
    )


async def handle_profile_answer(
    profile: UserProfile,
    last_question: str | None,
    user_answer: str | None,
) -> IntakeQuestionResult:
    if not (user_answer and last_question):
        return await ask_next_question(profile)

    target_field = next_missing_field(profile)
    result = await understand_answer(
        profile,
        last_question,
        user_answer,
        target_field=target_field,
    )
    profile = result.profile

    if result.status != "ok" and target_field is not None:
        still = next_missing_field(profile)
        if still == target_field:
            preface = result.assistant_message or (
                "Pas de souci — je reformule pour être plus clair."
                if result.status == "confused"
                else "On reste sur cette question :"
                if result.status == "off_topic"
                else "Peux-tu préciser un peu ?"
            )
            return await ask_next_question(profile, preface=preface)

    still_missing = next_missing_field(profile)
    if still_missing == target_field and target_field is not None:
        return await ask_next_question(
            profile,
            preface="Je n'ai pas pu noter ça clairement — on réessaie :",
        )

    return await ask_next_question(profile)
