"""
Orchestrator — thin deterministic step runner.

Owns session persistence and pipeline order. Delegates to the Intake agent
(verification → profile Q&A → tax classify → compliance — all inside intake).
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

PIPELINE: list[str] = [
    "intake",  # agents.intake (verify + questions + tax + compliance tools)
]


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
    """Persist completed intake profile (tax + compliance already applied by agent)."""
    state.phase = "done"
    state.last_question = None
    state.quick_replies = []
    state.profile_completeness = 1.0
    await async_save_session(state.session_id, state)
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
        state.profile = intake.skip_verification(state.profile)
        return await _intake_ask(state)

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
        return await _intake_ask(state)

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
