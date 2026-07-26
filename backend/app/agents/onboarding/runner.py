import logging
from app.schemas.onboarding import InfluencerProfile, OnboardingTurnResult
from app.agents.onboarding.extraction import extract_fields_from_answer
from app.agents.onboarding.questions import (
    next_missing_field,
    generate_question_for_field,
    completeness_ratio,
)

logger = logging.getLogger(__name__)


async def onboarding_turn(
    profile: InfluencerProfile,
    last_question: str | None,
    last_answer: str | None,
) -> OnboardingTurnResult:
    if last_answer and last_question:
        target_field = next_missing_field(profile)
        try:
            profile = await extract_fields_from_answer(
                profile, last_question, last_answer, target_field=target_field
            )
        except Exception as exc:
            logger.warning("Extraction failed (skipped): %s", exc)

    missing = next_missing_field(profile)

    if missing is None:
        return OnboardingTurnResult(
            profile=profile,
            is_done=True,
            completeness=1.0,
        )

    question, quick_replies = await generate_question_for_field(profile, missing)

    return OnboardingTurnResult(
        profile=profile,
        next_question=question,
        quick_replies=quick_replies,
        is_done=False,
        completeness=completeness_ratio(profile),
    )
