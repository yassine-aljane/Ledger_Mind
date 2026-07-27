"""Unified orchestrator pipeline — deterministic state machine, no LLM routing."""

import logging

from app.agents.compliance import check_compliance
from app.agents.onboarding.extraction import extract_fields_from_answer
from app.agents.onboarding.questions import (
    completeness_ratio,
    generate_question_for_field,
    next_missing_field,
)
from app.agents.tax_classifier import classify_tax_category
from app.agents.verification.runner import run_verification_agent
from app.core.session_store import async_create_session, async_get_session, async_save_session
from app.schemas.orchestrator import (
    OrchestratorState,
    OrchestratorTurnResponse,
    UserProfile,
)

logger = logging.getLogger(__name__)


def _verification_context(profile: UserProfile) -> dict | None:
    if not profile.ape_code and not profile.activity_declared:
        return None
    return {
        "ape_code": profile.ape_code,
        "activity_declared": profile.activity_declared,
        "denomination": profile.denomination,
    }


def _apply_verification_result(profile: UserProfile, result) -> UserProfile:
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


async def _ask_first_profile_question(state: OrchestratorState) -> OrchestratorTurnResponse:
    missing = next_missing_field(state.profile)
    if missing is None:
        return await _run_tax_and_compliance(state)

    question, quick_replies = await generate_question_for_field(
        state.profile,
        missing,
        verification_context=_verification_context(state.profile),
    )
    state.phase = "profile_questions"
    state.last_question = question
    state.quick_replies = quick_replies
    state.profile_completeness = completeness_ratio(state.profile)
    await async_save_session(state.session_id, state)
    return OrchestratorTurnResponse(
        session_id=state.session_id,
        phase=state.phase,
        ui_action="ask_question",
        message=question,
        quick_replies=quick_replies,
        profile=state.profile,
    )


async def _run_tax_and_compliance(state: OrchestratorState) -> OrchestratorTurnResponse:
    category, reason, regime, plafond = classify_tax_category(state.profile)
    state.profile.tax_category = category  # type: ignore[assignment]
    state.profile.tax_category_reason = reason
    state.profile.recommended_regime = regime
    state.profile.regime_plafond = plafond
    state.phase = "tax_classification"
    await async_save_session(state.session_id, state)

    activity_mismatch, mismatches, alerts, actions = check_compliance(state.profile)
    state.profile.activity_mismatch = activity_mismatch
    state.profile.mismatches = mismatches
    state.profile.compliance_alerts = alerts
    state.profile.recommended_actions = actions
    state.phase = "done"
    await async_save_session(state.session_id, state)

    return OrchestratorTurnResponse(
        session_id=state.session_id,
        phase=state.phase,
        ui_action="show_compliance",
        message=reason,
        quick_replies=[],
        profile=state.profile,
    )


def _state_to_response(state: OrchestratorState, ui_action: str, message: str | None = None) -> OrchestratorTurnResponse:
    return OrchestratorTurnResponse(
        session_id=state.session_id,
        phase=state.phase,
        ui_action=ui_action,  # type: ignore[arg-type]
        message=message,
        quick_replies=state.quick_replies,
        profile=state.profile,
    )


async def start_orchestrator(
    siret: str | None,
    company_name: str | None = None,
) -> OrchestratorTurnResponse:
    session_id = await async_create_session()
    state = await async_get_session(session_id)
    if state is None:
        raise RuntimeError("Failed to create session")

    if siret is None:
        state.skip_verification = True
        state.profile.verification_status = "skipped"
        return await _ask_first_profile_question(state)

    result = await run_verification_agent(siret, company_name)
    state.profile = _apply_verification_result(state.profile, result)
    state.verification_message = result.explanation
    state.phase = "verification"
    await async_save_session(session_id, state)

    return OrchestratorTurnResponse(
        session_id=session_id,
        phase=state.phase,
        ui_action="show_verification_result",
        message=result.explanation,
        quick_replies=[],
        profile=state.profile,
    )


async def orchestrator_turn(
    session_id: str,
    user_answer: str | None = None,
) -> OrchestratorTurnResponse:
    state = await async_get_session(session_id)
    if state is None:
        raise ValueError(f"Session not found: {session_id}")

    if state.phase == "verification":
        return await _ask_first_profile_question(state)

    if state.phase == "profile_questions":
        if user_answer and state.last_question:
            target_field = next_missing_field(state.profile)
            try:
                state.profile = await extract_fields_from_answer(
                    state.profile,
                    state.last_question,
                    user_answer,
                    target_field=target_field,
                )
            except Exception as exc:
                logger.warning("Extraction failed (skipped): %s", exc)

        missing = next_missing_field(state.profile)
        if missing is None:
            return await _run_tax_and_compliance(state)

        question, quick_replies = await generate_question_for_field(
            state.profile,
            missing,
            verification_context=_verification_context(state.profile),
        )
        state.last_question = question
        state.quick_replies = quick_replies
        state.profile_completeness = completeness_ratio(state.profile)
        await async_save_session(session_id, state)

        return OrchestratorTurnResponse(
            session_id=session_id,
            phase=state.phase,
            ui_action="ask_question",
            message=question,
            quick_replies=quick_replies,
            profile=state.profile,
        )

    if state.phase == "done":
        return OrchestratorTurnResponse(
            session_id=session_id,
            phase=state.phase,
            ui_action="done",
            message=state.profile.tax_category_reason,
            quick_replies=[],
            profile=state.profile,
        )

    # tax_classification / compliance_check should not be reachable as separate turns
    return _state_to_response(state, "done", state.profile.tax_category_reason)
