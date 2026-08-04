"""API du rapport fiscal — un seul rapport, assiette = CA ENCAISSÉ.

Distinct de `/api/rapport` (rapport d'activité historique, fondé sur le CA facturé) : ici
l'assiette est l'encaissé, seul chiffre déclarable. Le CA facturé figure DANS le rapport
comme indicateur d'écart, jamais comme un second résultat.

Les rapports générés sont archivés : un rapport est une photo de la période, et rejouer le
calcul plus tard donnerait d'autres chiffres dès qu'une pièce est corrigée.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.agents.rapport_fiscal import orchestrateur, store
from app.agents.rapport_fiscal.contexte_profil import (
    champs_bloquants,
    contexte_depuis_profil,
    origine_des_champs,
)
from app.agents.rapport_fiscal.pdf import rapport_to_pdf
from app.agents.rapport_fiscal.schemas import DemandeRapport, RapportFiscal
from app.api.deps import get_current_user
from app.schemas.auth import UserPublic
from app.schemas.orchestrator import UserProfile

router = APIRouter(prefix="/api/rapport-fiscal", tags=["rapport-fiscal"])


def _profil(user: UserPublic) -> UserProfile | None:
    """Profil déclaré à l'onboarding, ou `None` si le parcours n'a rien enregistré.

    Absent, le rapport se produit quand même : il calcule ce qu'il peut et dit le reste.
    """
    brut = user.agent_context.intake.profile
    if not brut:
        return None
    try:
        return UserProfile.model_validate(brut)
    except Exception:  # noqa: BLE001 — un profil illisible ne doit pas bloquer le rapport
        return None


@router.get("/contexte")
async def contexte_prerempli(user: UserPublic = Depends(get_current_user)):
    """Situation de l'utilisateur telle que l'onboarding la connaît, pour préremplir l'écran.

    C'est un PRÉREMPLISSAGE, pas une contrainte : l'écran affiche ces valeurs, l'utilisateur
    peut les corriger, et sa correction fait autorité pour le calcul.
    """
    profil = _profil(user)
    if profil is None:
        return {
            "contexte": None,
            "origine": {},
            "champs_bloquants": [],
            "profil_disponible": False,
        }
    return {
        "contexte": contexte_depuis_profil(profil).model_dump(mode="json"),
        "origine": origine_des_champs(profil),
        "champs_bloquants": champs_bloquants(profil),
        "profil_disponible": True,
        "denomination": profil.denomination,
        "siren": profil.siren,
        "regime": profil.recommended_regime,
    }


@router.post("", response_model=RapportFiscal)
async def generer_rapport_fiscal(
    demande: DemandeRapport,
    user: UserPublic = Depends(get_current_user),
):
    """Génère le rapport de la période et l'archive."""
    try:
        rapport = orchestrateur.generer(user.id, demande, profil=_profil(user))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if demande.enregistrer:
        store.enregistrer(rapport)
    return rapport


@router.get("")
async def lister_rapports(user: UserPublic = Depends(get_current_user)):
    """Rapports archivés, du plus récent au plus ancien."""
    return {"rapports": store.lister(user.id)}


@router.get("/{rapport_id}", response_model=RapportFiscal)
async def obtenir_rapport(rapport_id: str, user: UserPublic = Depends(get_current_user)):
    rapport = store.obtenir(user.id, rapport_id)
    if rapport is None:
        raise HTTPException(status_code=404, detail="Rapport introuvable.")
    return rapport


@router.get("/{rapport_id}/pdf")
async def exporter_rapport_pdf(rapport_id: str, user: UserPublic = Depends(get_current_user)):
    """PDF du rapport ARCHIVÉ — les chiffres du jour de sa génération, pas ceux d'aujourd'hui."""
    brut = store.obtenir(user.id, rapport_id)
    if brut is None:
        raise HTTPException(status_code=404, detail="Rapport introuvable.")

    rapport = RapportFiscal.model_validate(brut)
    nom = f"rapport-fiscal-{rapport.date_debut}-{rapport.date_fin}.pdf"
    return Response(
        content=rapport_to_pdf(rapport),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{nom}"'},
    )


@router.delete("/{rapport_id}")
async def supprimer_rapport(rapport_id: str, user: UserPublic = Depends(get_current_user)):
    if not store.supprimer(user.id, rapport_id):
        raise HTTPException(status_code=404, detail="Rapport introuvable.")
    return {"supprime": True}
