from fastapi import APIRouter, HTTPException

from app.schemas.onboarding import OnboardingTurnRequest, OnboardingTurnResult
from app.agents.onboarding.runner import onboarding_turn

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


@router.post("/turn", response_model=OnboardingTurnResult)
async def onboarding_turn_endpoint(payload: OnboardingTurnRequest):
    try:
        return await onboarding_turn(
            payload.profile, payload.last_question, payload.last_answer
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
