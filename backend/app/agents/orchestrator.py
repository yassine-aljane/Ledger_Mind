"""
Orchestrator — deterministic step runner.

Verification: identity (step 1) → registry doc OCR for EI (step 2) → SIRENE avis (step 3)
Profiling: activity + mixed activity + revenue (steps 4–5)
Finalize: classification + inconsistency (step 6)
"""

from __future__ import annotations

import logging

from app.agents import intake
from app.core.session_store import async_create_session, async_get_session, async_save_session
from app.schemas.orchestrator import (
    OrchestratorState,
    OrchestratorTurnResponse,
)

logger = logging.getLogger(__name__)

PIPELINE: list[str] = ["intake"]


def _response(
    state: OrchestratorState,
    ui_action: str,
    message: str | None = None,
) -> OrchestratorTurnResponse:
    return OrchestratorTurnResponse(
        session_id=state.session_id,
        phase=state.phase,
        ui_action=ui_action,  # type: ignore[arg-type]
        message=message,
        quick_replies=state.quick_replies,
        profile=state.profile,
    )


async def _finish_intake(state: OrchestratorState) -> OrchestratorTurnResponse:
    state.phase = "done"
    state.last_question = None
    state.quick_replies = []
    state.profile_completeness = 1.0
    await async_save_session(state.session_id, state)

    if state.profile.fiscal_classification_status == "requires_expert":
        return _response(
            state,
            "requires_expert",
            state.profile.fiscal_inconsistency_reason
            or "Incohérence détectée — contactez le SIE ou demandez un rescrit fiscal.",
        )

    return _response(
        state,
        "done",
        state.profile.tax_category_reason
        or "Profil complété et catégorie fiscale déterminée.",
    )


async def _intake_ask(state: OrchestratorState) -> OrchestratorTurnResponse:
    result = await intake.ask_next_question(state.profile)
    state.profile = result.profile
    if result.is_complete:
        return await _finish_intake(state)

    state.phase = "profile_questions"
    state.last_question = result.question
    state.quick_replies = result.quick_replies
    state.profile_completeness = result.completeness
    await async_save_session(state.session_id, state)
    return _response(state, "ask_question", result.question)


async def _advance_verification(state: OrchestratorState) -> OrchestratorTurnResponse:
    profile = state.profile

    if profile.registry_document_required and not profile.registry_document_uploaded:
        state.phase = "verification_registry_document"
        state.quick_replies = []
        await async_save_session(state.session_id, state)
        return _response(state, "upload_registry_document", intake.REGISTRY_DOC_MESSAGE)

    if not profile.sirene_document_uploaded:
        state.phase = "verification_document"
        state.quick_replies = []
        await async_save_session(state.session_id, state)
        return _response(state, "upload_sirene_document", intake.SIRENE_UPLOAD_MESSAGE)

    return await _intake_ask(state)


async def start_orchestrator(
    siret: str | None,
    company_name: str | None = None,
) -> OrchestratorTurnResponse:
    session_id = await async_create_session()
    state = await async_get_session(session_id)
    if state is None:
        raise RuntimeError("Failed to create session")

    if not siret or not siret.strip():
        raise ValueError(
            "Un numéro SIRET ou SIREN est requis pour créer un profil. "
            "Utilisez l'agent de régularisation si vous n'êtes pas encore immatriculé."
        )

    result = await intake.run_verification(siret, company_name)
    state.profile = intake.apply_verification_to_profile(state.profile, result)
    state.verification_message = result.explanation
    state.phase = "verification"
    await async_save_session(session_id, state)

    return _response(state, "show_verification_result", result.explanation)


async def orchestrator_turn(
    session_id: str,
    user_answer: str | None = None,
) -> OrchestratorTurnResponse:
    state = await async_get_session(session_id)
    if state is None:
        raise ValueError(f"Session not found: {session_id}")

    if state.phase == "verification":
        return await _advance_verification(state)

    if state.phase == "verification_registry_document":
        if state.profile.registry_document_uploaded:
            return await _advance_verification(state)
        return _response(state, "upload_registry_document", intake.REGISTRY_DOC_MESSAGE)

    if state.phase == "verification_document":
        if state.profile.sirene_document_uploaded:
            return await _intake_ask(state)
        return _response(state, "upload_sirene_document", intake.SIRENE_UPLOAD_MESSAGE)

    if state.phase == "profile_questions":
        result = await intake.handle_profile_answer(
            state.profile,
            state.last_question,
            user_answer,
        )
        state.profile = result.profile
        if result.is_complete:
            return await _finish_intake(state)

        state.last_question = result.question
        state.quick_replies = result.quick_replies
        state.profile_completeness = result.completeness
        await async_save_session(session_id, state)
        return _response(state, "ask_question", result.question)

    return _response(
        state,
        "done",
        state.profile.tax_category_reason or state.verification_message,
    )
