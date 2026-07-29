from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Any

from app.agents.orchestrator import orchestrator_turn, start_orchestrator
from app.api.deps import get_current_user, get_current_user_optional
from app.core.session_store import async_get_session, async_list_sessions_for_user
from app.schemas.auth import UserPublic
from app.schemas.orchestrator import (
    DiagnosticProfile,
    OrchestratorStartRequest,
    OrchestratorTurnRequest,
    OrchestratorTurnResponse,
    UserProfile,
)

router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])


class SessionDetail(BaseModel):
    session_id: str
    phase: str
    branch: str
    user_id: str | None = None
    profile: UserProfile
    diagnostic_profile: DiagnosticProfile | None = None
    roadmap: dict[str, Any] | None = None


class SessionSummary(BaseModel):
    session_id: str
    branch: str | None = None
    phase: str | None = None
    updated_at: str = ""


@router.post("/start", response_model=OrchestratorTurnResponse)
async def start(
    payload: OrchestratorStartRequest,
    user: UserPublic = Depends(get_current_user),
):
    use_diagnostic = payload.skip_verification or payload.branch == "guidance"
    if not use_diagnostic and (not payload.siret or not payload.siret.strip()):
        raise HTTPException(
            status_code=400,
            detail=(
                "Un numéro SIRET ou SIREN est requis pour créer un profil. "
                "Utilisez le diagnostic de régularisation si vous n'êtes pas encore immatriculé."
            ),
        )
    try:
        return await start_orchestrator(
            payload.siret,
            payload.company_name,
            skip_verification=payload.skip_verification or payload.branch == "guidance",
            branch=payload.branch,
            user_id=user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/turn", response_model=OrchestratorTurnResponse)
async def turn(
    payload: OrchestratorTurnRequest,
    user: UserPublic | None = Depends(get_current_user_optional),
):
    state = await async_get_session(payload.session_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {payload.session_id}")
    if state.user_id and (user is None or user.id != state.user_id):
        raise HTTPException(status_code=403, detail="Cette session ne vous appartient pas.")
    try:
        return await orchestrator_turn(payload.session_id, payload.user_answer)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/my-sessions", response_model=list[SessionSummary])
async def my_sessions(user: UserPublic = Depends(get_current_user)):
    rows = await async_list_sessions_for_user(user.id)
    return [SessionSummary(**row) for row in rows]


@router.get("/session/{session_id}", response_model=UserProfile)
async def get_session_profile(
    session_id: str,
    user: UserPublic | None = Depends(get_current_user_optional),
):
    state = await async_get_session(session_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    if state.user_id and (user is None or user.id != state.user_id):
        raise HTTPException(status_code=403, detail="Cette session ne vous appartient pas.")
    return state.profile


@router.get("/session/{session_id}/detail", response_model=SessionDetail)
async def get_session_detail(
    session_id: str,
    user: UserPublic | None = Depends(get_current_user_optional),
):
    state = await async_get_session(session_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    if state.user_id and (user is None or user.id != state.user_id):
        raise HTTPException(status_code=403, detail="Cette session ne vous appartient pas.")
    return SessionDetail(
        session_id=state.session_id,
        phase=state.phase,
        branch=state.branch,
        user_id=state.user_id,
        profile=state.profile,
        diagnostic_profile=state.diagnostic_profile,
        roadmap=state.roadmap,
    )


@router.get("/session/{session_id}/roadmap")
async def get_session_roadmap(
    session_id: str,
    user: UserPublic | None = Depends(get_current_user_optional),
):
    state = await async_get_session(session_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    if state.user_id and (user is None or user.id != state.user_id):
        raise HTTPException(status_code=403, detail="Cette session ne vous appartient pas.")
    if state.roadmap is None:
        raise HTTPException(status_code=404, detail="Roadmap not available for this session")
    return state.roadmap
