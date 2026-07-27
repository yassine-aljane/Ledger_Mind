import logging
from app.schemas.onboarding import InfluencerProfile, OnboardingTurnResult
from app.schemas.orchestrator import UserProfile
from app.agents.onboarding.extraction import extract_fields_from_answer
from app.agents.onboarding.questions import (
    next_missing_field,
    generate_question_for_field,
    completeness_ratio,
)

logger = logging.getLogger(__name__)


def _to_user_profile(profile: InfluencerProfile) -> UserProfile:
    return UserProfile(**profile.model_dump())


def _to_influencer_profile(profile: UserProfile) -> InfluencerProfile:
    data = {k: getattr(profile, k) for k in InfluencerProfile.model_fields}
    return InfluencerProfile(**data)


async def onboarding_turn(
    profile: InfluencerProfile,
    last_question: str | None,
    last_answer: str | None,
) -> OnboardingTurnResult:
    user_profile = _to_user_profile(profile)

    if last_answer and last_question:
        target_field = next_missing_field(user_profile)
        try:
            user_profile = await extract_fields_from_answer(
                user_profile, last_question, last_answer, target_field=target_field
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
