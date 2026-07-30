"""API de génération de facture — espace influenceur immatriculé (SIREN vérifié).

L'émetteur vient du profil de la branche A (intake), jamais ressaisi : sans SIREN vérifié,
l'entreprise n'existe pas légalement et aucune facture ne peut être émise en son nom.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.agents.facture import store
from app.agents.facture.generator import DonneesEmetteurIncompletes, generer_facture
from app.agents.facture.pdf import facture_to_pdf
from app.agents.facture.schemas import FactureRequest
from app.api.deps import get_current_user
from app.schemas.auth import UserPublic
from app.schemas.orchestrator import UserProfile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/facture", tags=["facture"])


def _profil_emetteur(user: UserPublic) -> UserProfile:
    """Profil vérifié de l'émetteur — snapshot léger tenu sur le compte (branche intake)."""
    brut = user.agent_context.intake.profile
    if not brut:
        raise HTTPException(
            status_code=409,
            detail="Vérifiez d'abord votre SIREN : aucune identité d'entreprise vérifiée n'est "
                   "associée à ce compte.",
        )
    return UserProfile.model_validate(brut)


@router.post("")
async def creer_facture(
    payload: FactureRequest,
    user: UserPublic = Depends(get_current_user),
):
    """Génère une facture depuis le modèle standard de la plateforme (voie par défaut)."""
    profil = _profil_emetteur(user)
    numero = store.prochain_numero(user.id)
    try:
        facture = generer_facture(user.id, numero, profil, payload)
    except DonneesEmetteurIncompletes as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    store.enregistrer(facture)
    return facture


@router.post("/depuis-template")
async def creer_facture_depuis_template(
    payload: FactureRequest,
    template: UploadFile,
    user: UserPublic = Depends(get_current_user),
):
    """Génère une facture à partir d'un template uploadé (image ou fichier).

    Le template n'est JAMAIS bloquant : toute erreur d'analyse retombe silencieusement sur le
    modèle standard. Pour l'instant, l'analyse de mise en page personnalisée n'est pas implémentée
    — le repli est donc systématique, mais déjà correctement câblé pour ne jamais faire échouer
    l'émission (voir template_source / template_upload_note sur la facture renvoyée).
    """
    profil = _profil_emetteur(user)
    numero = store.prochain_numero(user.id)

    note: str | None = None
    try:
        contenu = await template.read()
        if not contenu:
            raise ValueError("fichier vide")
        # Analyse de template : non implémentée pour l'instant (chantier futur). On le signale
        # sans jamais bloquer — c'est la garantie demandée en 1.1.
        note = "Analyse de template non disponible pour l'instant : modèle standard utilisé."
    except Exception as exc:  # noqa: BLE001 — le template ne doit jamais bloquer l'émission
        logger.info("Template de facture ignoré (%s) : %s", template.filename, exc)
        note = f"Template illisible ({exc}) : modèle standard utilisé."

    try:
        facture = generer_facture(
            user.id, numero, profil, payload,
            template_source="upload", template_upload_note=note,
        )
    except DonneesEmetteurIncompletes as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    store.enregistrer(facture)
    return facture


@router.get("")
async def lister_factures(
    depuis: str | None = None,
    jusqua: str | None = None,
    user: UserPublic = Depends(get_current_user),
):
    """Factures émises par l'utilisateur, filtrables par période — réutilisé par les rapports
    d'activité et la déclaration fiscale."""
    return {"factures": store.lister(user.id, depuis=depuis, jusqua=jusqua)}


@router.get("/{facture_id}")
async def obtenir_facture(facture_id: str, user: UserPublic = Depends(get_current_user)):
    facture = store.obtenir(user.id, facture_id)
    if not facture:
        raise HTTPException(status_code=404, detail="Facture introuvable.")
    return facture


@router.get("/{facture_id}/pdf")
async def facture_pdf(facture_id: str, user: UserPublic = Depends(get_current_user)):
    from app.agents.facture.schemas import Facture

    brut = store.obtenir(user.id, facture_id)
    if not brut:
        raise HTTPException(status_code=404, detail="Facture introuvable.")
    facture = Facture.model_validate(brut)
    pdf = facture_to_pdf(facture)
    return StreamingResponse(
        iter([pdf]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=facture_{facture.numero}.pdf"},
    )
