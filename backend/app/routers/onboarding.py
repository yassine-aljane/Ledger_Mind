"""Deprecated onboarding endpoint — thin wrapper over the Intake agent."""

import logging

from fastapi import APIRouter, HTTPException

from app.agents.intake.tools.extract_answer import extract_fields_from_answer
from app.agents.intake.questions import (
    completeness_ratio,
    generate_question_for_field,
    next_missing_field,
)
from app.schemas.onboarding import InfluencerProfile, OnboardingTurnRequest, OnboardingTurnResult
from app.schemas.orchestrator import UserProfile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


def _to_user_profile(profile: InfluencerProfile) -> UserProfile:
    return UserProfile(**profile.model_dump())


def _to_influencer_profile(profile: UserProfile) -> InfluencerProfile:
    data = {k: getattr(profile, k) for k in InfluencerProfile.model_fields}
    return InfluencerProfile(**data)


@router.post("/turn", response_model=OnboardingTurnResult)
async def onboarding_turn_endpoint(payload: OnboardingTurnRequest):
    try:
        user_profile = _to_user_profile(payload.profile)

        if payload.last_answer and payload.last_question:
            target_field = next_missing_field(user_profile)
            try:
                user_profile = await extract_fields_from_answer(
                    user_profile,
                    payload.last_question,
                    payload.last_answer,
                    target_field=target_field,
                )
            except Exception as exc:
                logger.warning("Extraction failed (skipped): %s", exc)

        missing = next_missing_field(user_profile)
        if missing is None:
            return OnboardingTurnResult(
                profile=_to_influencer_profile(user_profile),
                is_done=True,
                completeness=1.0,
            )

        question, quick_replies = await generate_question_for_field(user_profile, missing)
        return OnboardingTurnResult(
            profile=_to_influencer_profile(user_profile),
            next_question=question,
            quick_replies=quick_replies,
            is_done=False,
            completeness=completeness_ratio(user_profile),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
