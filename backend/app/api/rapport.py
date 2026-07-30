"""API du rapport d'activité par période — espace immatriculé (SIREN vérifié)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.agents.rapport import store
from app.agents.rapport.generator import generer_rapport
from app.agents.rapport.pdf import rapport_to_pdf
from app.agents.rapport.schemas import PeriodeRequest, RapportActivite
from app.api.deps import get_current_user
from app.schemas.auth import UserPublic

router = APIRouter(prefix="/api/rapport", tags=["rapport"])


@router.post("")
async def creer_rapport(
    payload: PeriodeRequest,
    objectif: str | None = None,
    user: UserPublic = Depends(get_current_user),
):
    if payload.date_fin < payload.date_debut:
        raise HTTPException(status_code=422, detail="La date de fin précède la date de début.")
    rapport = await generer_rapport(user.id, payload, objectif)
    store.enregistrer(rapport)
    return rapport


@router.get("")
async def lister_rapports(user: UserPublic = Depends(get_current_user)):
    return {"rapports": store.lister(user.id)}


@router.get("/{rapport_id}")
async def obtenir_rapport(rapport_id: str, user: UserPublic = Depends(get_current_user)):
    rapport = store.obtenir(user.id, rapport_id)
    if not rapport:
        raise HTTPException(status_code=404, detail="Rapport introuvable.")
    return rapport


@router.get("/{rapport_id}/pdf")
async def rapport_pdf(rapport_id: str, user: UserPublic = Depends(get_current_user)):
    brut = store.obtenir(user.id, rapport_id)
    if not brut:
        raise HTTPException(status_code=404, detail="Rapport introuvable.")
    rapport = RapportActivite.model_validate(brut)
    pdf = rapport_to_pdf(rapport)
    return StreamingResponse(
        iter([pdf]),
        media_type="application/pdf",
        headers={"Content-Disposition":
                 f"attachment; filename=rapport_{rapport.date_debut}_{rapport.date_fin}.pdf"},
    )
