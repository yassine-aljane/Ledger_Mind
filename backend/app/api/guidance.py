"""API de l'espace « pas encore immatriculé » — chat conversationnel, mémoire, feuille de route.

Complète l'orchestrateur (`/api/orchestrator`, machine à états de la branche SIREN) par le
parcours CONVERSATIONNEL de la branche sans SIREN : profilage au fil de la discussion, fiche de
statut qui se remplit toute seule, historique des conversations, feuille de route déterministe.

Le profil est partagé par utilisateur (`uid` = identifiant du compte authentifié). Sans
authentification, `uid` vient de l'en-tête `X-Anon-Id` (un identifiant généré et conservé côté
navigateur, voir `frontend/src/lib/anon.ts`) — PAS d'un identifiant `demo` partagé par tout le
monde : un `uid` unique partagé entre visiteurs anonymes mélangeait leurs profils respectifs
(CA, activité...) dans le même document Mongo, ce qui dégradait progressivement les réponses de
l'agent pour tout le monde. Chaque visiteur anonyme a désormais sa propre mémoire, isolée.
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agents.guidance import conversation
from app.agents.guidance.roadmap.parcours import build_roadmap
from app.api.deps import get_current_user_optional
from app.core import conversation_store as store
from app.schemas.auth import UserPublic

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/guidance", tags=["guidance"])

_ANON_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


async def _current_uid(
    user: UserPublic | None = Depends(get_current_user_optional),
    x_anon_id: str | None = Header(default=None, alias="X-Anon-Id"),
) -> str:
    if user:
        return user.id
    if x_anon_id and _ANON_ID_RE.match(x_anon_id):
        return f"anon-{x_anon_id}"
    # Pas d'en-tête (client ancien/sans JS) : identité isolée pour cette requête plutôt qu'un
    # identifiant partagé — dégrade la continuité mais jamais la mémoire d'un autre visiteur.
    return f"anon-{uuid.uuid4()}"


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


class AskRequest(BaseModel):
    question: str = Field(min_length=1)
    concerne: str | None = Field(default=None, description="influenceur | freelance | None")


# ------------------------------------------------------------------------------------ Chat
@router.post("/chat")
async def chat(payload: ChatRequest, uid: str = Depends(_current_uid)):
    """Un tour de conversation : profilage, question suivante OU feuille de route."""
    action = payload.action.model_dump() if payload.action else None
    mode = payload.mode or "guidance"
    result = await conversation.respond(
        payload.session_id, payload.message, mode, action=action, uid=uid,
    )
    # Compte authentifié (jamais un visiteur anonyme) + branche guidance (pas pédagogue) :
    # tient à jour agent_context.guidance, sinon jamais peuplé par ce parcours (voir
    # sync_guidance_snapshot) — postAuthPath() ne saurait sinon jamais renvoyer un utilisateur
    # guidance-only vers sa feuille de route à la reconnexion.
    if mode == "guidance" and not uid.startswith("anon-"):
        from app.core.users import sync_guidance_snapshot

        sync_guidance_snapshot(
            uid, session_id=result["session_id"],
            phase="done" if result.get("roadmap") else "diagnostic_questions",
            profil=result.get("profil") or {}, roadmap=result.get("roadmap"),
            completeness=1.0 if result.get("profil_complet") else 0.5,
        )
    return result


@router.post("/ask")
async def ask(payload: AskRequest, uid: str = Depends(_current_uid)):
    """Question fiscale ponctuelle, sans conversation : réponse ancrée sur le corpus et sourcée.

    L'agent refuse d'inventer un chiffre absent des extraits et s'aligne sur le verdict
    déterministe du régime quand le profil permet de le calculer.
    """
    from app.agents import pedagogue

    profil = await store.async_get_profil(uid)
    verdict = conversation.verdict_courant(profil) if profil.get("ca_estime") is not None else None
    return await pedagogue.answer(payload.question, concerne=payload.concerne,
                                  profil=profil, regime_verdict=verdict)


@router.get("/corpus")
async def corpus_status():
    """État du corpus documentaire (nombre de chunks indexés)."""
    from app.rag import vectorstore

    chunks = await asyncio.to_thread(vectorstore.count)
    return {"chunks": chunks, "pret": chunks > 0}


@router.post("/veille/run")
async def veille_run():
    """Déclenche un cycle de veille (collecte MCP, ré-ingestion, contrôle des seuils)."""
    from app.veille import scheduler

    return await scheduler.run_veille()


@router.get("/veille/last")
async def veille_last():
    from app.veille import scheduler

    return scheduler.dernier_rapport()


@router.get("/suggestions")
async def suggestions(uid: str = Depends(_current_uid)):
    """Suggestions d'ouverture, affichées avant le premier message.

    Elles s'adaptent : tant que rien n'est connu, ce sont des amorces de description d'activité ;
    dès que le profil se remplit, ce sont les réponses rapides à la question courante.
    """
    profil = await asyncio.to_thread(store.get_profil, uid)
    ouverture = [
        "Je débute sur Instagram et je gagne de l'argent, par où commencer ?",
        "Je fais des vidéos YouTube, environ 3000 € par mois",
        "Je veux créer mon activité de freelance",
    ]
    # Tant que rien n'est connu, on propose des AMORCES de récit — décrire son activité avec ses
    # mots. Les réponses rapides (« Création de contenu »…) ne prennent le relais qu'une fois la
    # conversation engagée, quand elles répondent à une question réellement posée.
    vierge = not any(v is not None for v in (profil or {}).values())
    contextuelles = conversation.suggestions_pour(profil)
    return {"suggestions": ouverture if vierge else (contextuelles or ouverture),
            # Toujours peuplé dès qu'une information manque (y compris au tout premier tour,
            # "activite") — c'est la structure que le front doit préférer pour les chips ; les
            # "amorces" de récit ci-dessus restent l'alternative narrative, jamais bloquante.
            "suggestions_champ": conversation.suggestions_champ_pour(profil),
            "profil": profil,
            "profil_complet": not conversation.questions_manquantes(profil)}


class AffinerSuggestionsRequest(BaseModel):
    champ: str = Field(min_length=1)


@router.post("/suggestions/affiner")
async def affiner_suggestions(payload: AffinerSuggestionsRequest, uid: str = Depends(_current_uid)):
    """Affine par LLM les 3 suggestions d'un champ OUVERT (ex. ca_estime), à partir du contexte
    déjà connu — appelé en tâche de fond par le front pendant que les valeurs déterministes par
    défaut sont déjà affichées (progressive enhancement, jamais bloquant)."""
    profil = await asyncio.to_thread(store.get_profil, uid)
    suggestions = await conversation.affiner_suggestions(payload.champ, profil)
    return {"suggestions": suggestions}


# -------------------------------------------------------------------- Historique des échanges
@router.get("/conversations")
async def list_conversations(type: str | None = "guidance",
                             uid: str = Depends(_current_uid)):
    """Conversations de l'utilisateur, filtrées par interface, la plus récente en premier."""
    rows = await store.async_list_sessions(uid, type)
    return {"conversations": rows}


@router.get("/chat/{session_id}")
async def chat_history(session_id: str, uid: str = Depends(_current_uid)):
    """Conversation complète + profil + feuille de route + cases cochées."""
    meta = await asyncio.to_thread(store.session_meta, session_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Conversation introuvable ou expirée.")
    if meta.get("uid") and meta["uid"] != uid:
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
                              uid: str = Depends(_current_uid)):
    meta = await asyncio.to_thread(store.session_meta, session_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Conversation introuvable ou expirée.")
    if meta.get("uid") and meta["uid"] != uid:
        raise HTTPException(status_code=403, detail="Cette conversation ne vous appartient pas.")
    await asyncio.to_thread(store.rename_session, session_id, payload.title)
    return {"session_id": session_id, "title": payload.title.strip()[:120]}


@router.delete("/chat/{session_id}")
async def delete_conversation(session_id: str,
                              uid: str = Depends(_current_uid)):
    meta = await asyncio.to_thread(store.session_meta, session_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Conversation introuvable ou expirée.")
    if meta.get("uid") and meta["uid"] != uid:
        raise HTTPException(status_code=403, detail="Cette conversation ne vous appartient pas.")
    await asyncio.to_thread(store.delete_session, session_id)
    return {"session_id": session_id, "supprimee": True}


# ----------------------------------------------------- Profil partagé (fiche de statut adaptative)
@router.get("/profil")
async def get_profil(uid: str = Depends(_current_uid)):
    profil = await store.async_get_profil(uid)
    return {"profil": profil, "verdict": conversation.verdict_courant(profil) if profil else None,
            "manquantes": [q["champ"] for q in conversation.questions_manquantes(profil)]}


@router.patch("/profil")
async def patch_profil(payload: ProfilPatchRequest,
                       uid: str = Depends(_current_uid)):
    """Correction manuelle depuis la fiche de statut (chaque carte est éditable)."""
    profil = await store.async_patch_profil(uid, payload.model_dump())
    return {"profil": profil,
            "manquantes": [q["champ"] for q in conversation.questions_manquantes(profil)]}


@router.delete("/profil/{field}")
async def clear_profil_field(field: str,
                             uid: str = Depends(_current_uid)):
    """Efface une information du profil (croix sur une carte de la fiche de statut)."""
    if field not in store.PROFILE_FIELDS:
        raise HTTPException(status_code=400, detail=f"Champ inconnu : {field}")
    profil = await asyncio.to_thread(store.clear_profil_field, uid, field)
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
                      uid: str = Depends(_current_uid)):
    """Feuille de route en PDF téléchargeable.

    Priorité à la feuille de route PERSISTÉE de la conversation : le PDF est ainsi strictement
    identique à ce que voit l'utilisateur. À défaut, elle est reconstruite depuis le profil.
    """
    roadmap = None
    if payload.session_id:
        etat = await asyncio.to_thread(store.get_roadmap, payload.session_id) or {}
        roadmap = etat.get("roadmap")
    if roadmap is None:
        profil = payload.profil or await store.async_get_profil(uid)
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
