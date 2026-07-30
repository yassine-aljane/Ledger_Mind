"""API de recherche d'experts-comptables — déclenchable depuis la déclaration (« faire vérifier/
signer ») et ailleurs dans l'espace immatriculé."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.agents.expert_comptable.search import VilleIntrouvable, rechercher
from app.api.deps import get_current_user
from app.schemas.auth import UserPublic

router = APIRouter(prefix="/api/expert-comptable", tags=["expert-comptable"])


@router.get("")
async def rechercher_experts_comptables(
    ville: str,
    user: UserPublic = Depends(get_current_user),
):
    try:
        return rechercher(ville)
    except VilleIntrouvable as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
