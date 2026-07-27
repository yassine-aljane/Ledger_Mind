from fastapi import APIRouter, HTTPException

from app.agents.orchestrator import orchestrator_turn, start_orchestrator
from app.core.session_store import async_get_session
from app.schemas.orchestrator import (
    OrchestratorStartRequest,
    OrchestratorTurnRequest,
    OrchestratorTurnResponse,
    UserProfile,
)

router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])


@router.post("/start", response_model=OrchestratorTurnResponse)
async def start(payload: OrchestratorStartRequest):
    try:
        return await start_orchestrator(payload.siret, payload.company_name)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/turn", response_model=OrchestratorTurnResponse)
async def turn(payload: OrchestratorTurnRequest):
    try:
        return await orchestrator_turn(payload.session_id, payload.user_answer)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/session/{session_id}", response_model=UserProfile)
async def get_session_profile(session_id: str):
    state = await async_get_session(session_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    return state.profile
