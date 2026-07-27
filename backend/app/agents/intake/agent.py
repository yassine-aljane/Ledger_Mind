"""
Intake agent public API.

Flow: optional SIRET verification → profile Q&A (Gemini) → tax classify +
compliance (deterministic tools) when questions are complete.
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

logger = logging.getLogger(__name__)


@dataclass
class IntakeQuestionResult:
    profile: UserProfile
    question: str | None
    quick_replies: list[str]
    completeness: float
    is_complete: bool


def finalize_profile(profile: UserProfile) -> UserProfile:
    """Run tax classification + compliance tools after Q&A is complete."""
    category, reason, regime, plafond = classify_tax_category(profile)
    profile.tax_category = category  # type: ignore[assignment]
    profile.tax_category_reason = reason
    profile.recommended_regime = regime
    profile.regime_plafond = plafond

    activity_mismatch, mismatches, alerts, actions = check_compliance(profile)
    profile.activity_mismatch = activity_mismatch
    profile.mismatches = mismatches
    profile.compliance_alerts = alerts
    profile.recommended_actions = actions
    return profile


def verification_context(profile: UserProfile) -> dict | None:
    if not profile.ape_code and not profile.activity_declared:
        return None
    return {
        "ape_code": profile.ape_code,
        "activity_declared": profile.activity_declared,
        "denomination": profile.denomination,
    }


def apply_verification_to_profile(profile: UserProfile, result: VerificationResult) -> UserProfile:
    profile.siret = result.siret
    profile.siren = result.siret[:9] if result.siret else None
    profile.denomination = result.denomination
    profile.legal_form = result.legal_form
    profile.ape_code = result.ape_code
    profile.activity_declared = result.activity_declared
    profile.creation_date = result.creation_date
    profile.administrative_status = result.administrative_status
    profile.verification_status = result.status
    return profile


def skip_verification(profile: UserProfile) -> UserProfile:
    profile.verification_status = "skipped"
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

    # Confused / off-topic / unclear → explain + re-ask same field
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
            logger.info(
                "REASK field=%s status=%s preface=%r",
                target_field,
                result.status,
                preface,
            )
            return await ask_next_question(profile, preface=preface)

    # Field still empty after "ok" with no usable extract → soft re-ask
    still_missing = next_missing_field(profile)
    if still_missing == target_field and target_field is not None:
        return await ask_next_question(
            profile,
            preface="Je n'ai pas pu noter ça clairement — on réessaie :",
        )

    return await ask_next_question(profile)
