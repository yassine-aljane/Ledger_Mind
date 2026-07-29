"""API de l'espace « pas encore immatriculé » — chat conversationnel, mémoire, feuille de route.

Complète l'orchestrateur (`/api/orchestrator`, machine à états de la branche SIREN) par le
parcours CONVERSATIONNEL de la branche sans SIREN : profilage au fil de la discussion, fiche de
statut qui se remplit toute seule, historique des conversations, feuille de route déterministe.

Le profil est partagé par utilisateur (`uid` = identifiant du compte authentifié) ; sans
authentification, l'espace fonctionne sur l'identité de démonstration `demo`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agents.guidance import conversation
from app.agents.guidance.roadmap.parcours import build_roadmap
from app.api.deps import get_current_user_optional
from app.core import conversation_store as store
from app.schemas.auth import UserPublic

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/guidance", tags=["guidance"])

_DEMO_UID = "demo"


def _uid(user: UserPublic | None) -> str:
    return user.id if user else _DEMO_UID


# --------------------------------------------------------------------------------- Schémas
class ChatOption(BaseModel):
    kind: str
    value: str


class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str = Field(min_length=1)
    mode: str | None = Field(default="guidance", pattern="^(guidance|pedagogue)$")
    action: ChatOption | None = None


class RenameRequest(BaseModel):
    title: str = Field(min_length=1)


class RoadmapStateRequest(BaseModel):
    checked: dict = Field(default_factory=dict)


class ProfilPatchRequest(BaseModel):
    activite: str | None = None
    ca_estime: float | None = None
    vend_produits: bool | None = None
    recoit_cadeaux: bool | None = None
    anciennete: str | None = None
    situation_actuelle: str | None = None
    statut_actuel: str | None = None
    regime_actuel: str | None = None
    deja_immatricule: bool | None = None
    ca_prestations: float | None = None
    ca_vente: float | None = None
    remuneration_nature: float | None = None
    devise: str | None = None
    choix_parcours: str | None = None
    ca_n_1_au_dessus_seuil: bool | None = None


class RoadmapPdfRequest(BaseModel):
    session_id: str | None = None
    profil: dict[str, Any] | None = None


# ------------------------------------------------------------------------------------ Chat
@router.post("/chat")
async def chat(payload: ChatRequest, user: UserPublic | None = Depends(get_current_user_optional)):
    """Un tour de conversation : profilage, question suivante OU feuille de route."""
    action = payload.action.model_dump() if payload.action else None
    return await conversation.respond(
        payload.session_id, payload.message, payload.mode or "guidance",
        action=action, uid=_uid(user),
    )


@router.get("/suggestions")
async def suggestions(user: UserPublic | None = Depends(get_current_user_optional)):
    """Suggestions d'ouverture, affichées avant le premier message.

    Elles s'adaptent : tant que rien n'est connu, ce sont des amorces de description d'activité ;
    dès que le profil se remplit, ce sont les réponses rapides à la question courante.
    """
    profil = await asyncio.to_thread(store.get_profil, _uid(user))
    ouverture = [
        "Je débute sur Instagram et je gagne de l'argent, par où commencer ?",
        "Je fais des vidéos YouTube, environ 3000 par mois",
        "Je veux créer mon activité de freelance",
    ]
    contextuelles = conversation.suggestions_pour(profil)
    return {"suggestions": contextuelles or ouverture, "profil": profil,
            "profil_complet": not conversation.questions_manquantes(profil)}


# -------------------------------------------------------------------- Historique des échanges
@router.get("/conversations")
async def list_conversations(type: str | None = "guidance",
                             user: UserPublic | None = Depends(get_current_user_optional)):
    """Conversations de l'utilisateur, filtrées par interface, la plus récente en premier."""
    rows = await store.async_list_sessions(_uid(user), type)
    return {"conversations": rows}


@router.get("/chat/{session_id}")
async def chat_history(session_id: str, user: UserPublic | None = Depends(get_current_user_optional)):
    """Conversation complète + profil + feuille de route + cases cochées."""
    meta = await asyncio.to_thread(store.session_meta, session_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Conversation introuvable ou expirée.")
    if meta.get("uid") and meta["uid"] != _uid(user):
        raise HTTPException(status_code=403, detail="Cette conversation ne vous appartient pas.")
    etat = await asyncio.to_thread(store.get_roadmap, session_id) or {}
    profil = await asyncio.to_thread(store.get_profil_by_session, session_id)
    return {
        "session_id": session_id,
        "type": meta["type"],
        "title": meta["title"],
        "messages": await store.async_history(session_id),
        "profil": profil,
        "roadmap": etat.get("roadmap"),
        "checked": etat.get("checked", {}),
        "profil_complet": not conversation.questions_manquantes(profil),
    }


@router.patch("/chat/{session_id}/rename")
async def rename_conversation(session_id: str, payload: RenameRequest,
                              user: UserPublic | None = Depends(get_current_user_optional)):
    meta = await asyncio.to_thread(store.session_meta, session_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Conversation introuvable ou expirée.")
    if meta.get("uid") and meta["uid"] != _uid(user):
        raise HTTPException(status_code=403, detail="Cette conversation ne vous appartient pas.")
    await asyncio.to_thread(store.rename_session, session_id, payload.title)
    return {"session_id": session_id, "title": payload.title.strip()[:120]}


@router.delete("/chat/{session_id}")
async def delete_conversation(session_id: str,
                              user: UserPublic | None = Depends(get_current_user_optional)):
    meta = await asyncio.to_thread(store.session_meta, session_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Conversation introuvable ou expirée.")
    if meta.get("uid") and meta["uid"] != _uid(user):
        raise HTTPException(status_code=403, detail="Cette conversation ne vous appartient pas.")
    await asyncio.to_thread(store.delete_session, session_id)
    return {"session_id": session_id, "supprimee": True}


# ----------------------------------------------------- Profil partagé (fiche de statut adaptative)
@router.get("/profil")
async def get_profil(user: UserPublic | None = Depends(get_current_user_optional)):
    profil = await store.async_get_profil(_uid(user))
    return {"profil": profil, "verdict": conversation.verdict_courant(profil) if profil else None,
            "manquantes": [q["champ"] for q in conversation.questions_manquantes(profil)]}


@router.patch("/profil")
async def patch_profil(payload: ProfilPatchRequest,
                       user: UserPublic | None = Depends(get_current_user_optional)):
    """Correction manuelle depuis la fiche de statut (chaque carte est éditable)."""
    profil = await store.async_patch_profil(_uid(user), payload.model_dump())
    return {"profil": profil,
            "manquantes": [q["champ"] for q in conversation.questions_manquantes(profil)]}


@router.delete("/profil/{field}")
async def clear_profil_field(field: str,
                             user: UserPublic | None = Depends(get_current_user_optional)):
    """Efface une information du profil (croix sur une carte de la fiche de statut)."""
    if field not in store.PROFILE_FIELDS:
        raise HTTPException(status_code=400, detail=f"Champ inconnu : {field}")
    profil = await asyncio.to_thread(store.clear_profil_field, _uid(user), field)
    return {"profil": profil,
            "manquantes": [q["champ"] for q in conversation.questions_manquantes(profil)]}


# ------------------------------------------------------------------------- Feuille de route
@router.get("/roadmap/state/{session_id}")
async def get_roadmap_state(session_id: str):
    etat = await asyncio.to_thread(store.get_roadmap, session_id) or {}
    return {"session_id": session_id, "roadmap": etat.get("roadmap"),
            "checked": etat.get("checked", {})}


@router.put("/roadmap/state/{session_id}")
async def save_roadmap_state(session_id: str, payload: RoadmapStateRequest):
    """État coché de la feuille de route, persisté côté serveur avec la conversation."""
    await asyncio.to_thread(store.save_roadmap, session_id, None, payload.checked)
    return {"session_id": session_id, "checked": payload.checked}


@router.post("/roadmap/pdf")
async def roadmap_pdf(payload: RoadmapPdfRequest,
                      user: UserPublic | None = Depends(get_current_user_optional)):
    """Feuille de route en PDF téléchargeable.

    Priorité à la feuille de route PERSISTÉE de la conversation : le PDF est ainsi strictement
    identique à ce que voit l'utilisateur. À défaut, elle est reconstruite depuis le profil.
    """
    roadmap = None
    if payload.session_id:
        etat = await asyncio.to_thread(store.get_roadmap, payload.session_id) or {}
        roadmap = etat.get("roadmap")
    if roadmap is None:
        profil = payload.profil or await store.async_get_profil(_uid(user))
        if not profil:
            raise HTTPException(status_code=404, detail="Aucune feuille de route à exporter.")
        roadmap = build_roadmap({**profil, "ca_estime_annuel": profil.get("ca_estime", 0)})

    try:
        from app.agents.guidance.roadmap.pdf import roadmap_to_pdf
        pdf = await asyncio.to_thread(roadmap_to_pdf, roadmap)
    except ImportError as exc:  # noqa: BLE001 — moteur PDF non installé
        logger.warning("Export PDF indisponible : %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Export PDF indisponible : installez fpdf2 (ou WeasyPrint) côté serveur.",
        ) from exc

    return StreamingResponse(
        iter([pdf]),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=feuille_de_route_ledgermind.pdf"},
    )
