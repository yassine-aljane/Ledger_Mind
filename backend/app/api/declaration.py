"""API de la déclaration fiscale préparée — espace immatriculé (SIREN vérifié).

Ne transmet jamais à l'administration : produit un document de préparation, revu par
l'utilisateur (PATCH .../revue), destiné à être vérifié et signé par un expert-comptable.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.agents.declaration import store
from app.agents.declaration.generator import generer_declaration
from app.agents.declaration.pdf import declaration_to_pdf
from app.agents.declaration.schemas import Declaration
from app.api.deps import get_current_user
from app.schemas.auth import UserPublic

router = APIRouter(prefix="/api/declaration", tags=["declaration"])


class PeriodeDeclarationRequest(BaseModel):
    date_debut: date
    date_fin: date
    rapport_source_id: str | None = None


@router.post("")
async def creer_declaration(
    payload: PeriodeDeclarationRequest,
    user: UserPublic = Depends(get_current_user),
):
    if payload.date_fin < payload.date_debut:
        raise HTTPException(status_code=422, detail="La date de fin précède la date de début.")
    declaration = generer_declaration(
        user.id, payload.date_debut, payload.date_fin, payload.rapport_source_id,
    )
    store.enregistrer(declaration)
    return declaration


@router.get("")
async def lister_declarations(user: UserPublic = Depends(get_current_user)):
    return {"declarations": store.lister(user.id)}


@router.get("/{declaration_id}")
async def obtenir_declaration(declaration_id: str, user: UserPublic = Depends(get_current_user)):
    declaration = store.obtenir(user.id, declaration_id)
    if not declaration:
        raise HTTPException(status_code=404, detail="Déclaration introuvable.")
    return declaration


@router.patch("/{declaration_id}/revue")
async def marquer_revue(declaration_id: str, user: UserPublic = Depends(get_current_user)):
    """L'utilisateur confirme avoir relu chaque case avant transmission à son comptable."""
    declaration = store.marquer_revue(user.id, declaration_id)
    if not declaration:
        raise HTTPException(status_code=404, detail="Déclaration introuvable.")
    return declaration


@router.get("/{declaration_id}/pdf")
async def declaration_pdf(declaration_id: str, user: UserPublic = Depends(get_current_user)):
    brut = store.obtenir(user.id, declaration_id)
    if not brut:
        raise HTTPException(status_code=404, detail="Déclaration introuvable.")
    declaration = Declaration.model_validate(brut)
    pdf = declaration_to_pdf(declaration)
    return StreamingResponse(
        iter([pdf]),
        media_type="application/pdf",
        headers={"Content-Disposition":
                 f"attachment; filename=declaration_{declaration.date_debut}_"
                 f"{declaration.date_fin}.pdf"},
    )
