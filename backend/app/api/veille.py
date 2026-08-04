"""API de la veille fiscale personnalisée.

Remplace `GET /api/echeancier/veille`, qui lisait un rapport en mémoire filtré par simples
étiquettes d'activité et exigeait un SIREN vérifié.

À ne pas confondre avec `/api/guidance/veille/*` : celle-ci rafraîchit le CORPUS RAG derrière
l'agent pédagogue. Ce sont deux sujets différents, et les deux coexistent volontairement.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.core.conversation_store import async_get_profil
from app.schemas.auth import UserPublic
from app.veille import agent, store

router = APIRouter(prefix="/api/veille", tags=["veille"])


class PreferencesRequest(BaseModel):
    active: bool | None = None
    mode: str | None = None


async def _profil_guidance(user: UserPublic) -> dict | None:
    """Le profil de la branche B, s'il existe. Son absence n'est pas une erreur."""
    try:
        return await async_get_profil(user.id)
    except Exception:  # noqa: BLE001
        return None


@router.get("")
async def fil_de_veille(
    contexte: bool = Query(
        True,
        description="Inclure les nouveautés de contexte, trop faibles pour être notifiées.",
    ),
    user: UserPublic = Depends(get_current_user),
):
    """Les nouveautés qui concernent cet utilisateur, la plus contraignante d'abord.

    Aucun SIREN vérifié n'est exigé : un utilisateur de la branche B (diagnostic sans
    immatriculation) est justement celui qui a le plus besoin de savoir qu'une règle change.
    Un profil incomplet donne simplement moins de nouveautés retenues.
    """
    guidance = await _profil_guidance(user)
    return {
        "nouveautes": agent.pour_utilisateur(user, guidance, inclure_contexte=contexte),
        "preferences": store.get_preferences(user.id).model_dump(),
    }


@router.get("/notifications")
async def mes_notifications(
    non_lues: bool = Query(False, description="Ne renvoyer que les notifications non lues."),
    user: UserPublic = Depends(get_current_user),
):
    """Le lot de notifications, enrichi du contenu de chaque nouveauté."""
    notifs = store.notifications_de(user.id, non_lues_seulement=non_lues)
    contenus = store.lister_nouveautes([n["nouveaute_id"] for n in notifs])
    sortie = []
    for n in notifs:
        contenu = contenus.get(n["nouveaute_id"])
        if contenu is None:
            continue  # nouveauté purgée : on n'affiche pas une notification vide
        sortie.append(
            {
                **contenu.model_dump(),
                "pertinence": n.get("pertinence"),
                "pourquoi_vous": n.get("pourquoi_vous"),
                "champs_profil_declencheurs": n.get("champs_profil_declencheurs", []),
                "date_notifiee": n.get("date_notifiee"),
                "lue": n.get("lue", False),
            }
        )
    return {"notifications": sortie, "non_lues": sum(1 for n in notifs if not n.get("lue"))}


@router.post("/notifications/{nouveaute_id}/lue")
async def marquer_lue(nouveaute_id: str, user: UserPublic = Depends(get_current_user)):
    if not store.marquer_lue(user.id, nouveaute_id):
        raise HTTPException(status_code=404, detail="Notification introuvable ou déjà lue.")
    return {"ok": True}


@router.post("/notifications/lues")
async def marquer_tout_lu(user: UserPublic = Depends(get_current_user)):
    return {"marquees": store.marquer_tout_lu(user.id)}


@router.get("/preferences")
async def lire_preferences(user: UserPublic = Depends(get_current_user)):
    return store.get_preferences(user.id).model_dump()


@router.patch("/preferences")
async def ecrire_preferences(
    body: PreferencesRequest, user: UserPublic = Depends(get_current_user)
):
    if body.mode is not None and body.mode not in ("tout", "obligatoire_seulement"):
        raise HTTPException(status_code=422, detail="mode invalide.")
    return store.set_preferences(user.id, active=body.active, mode=body.mode).model_dump()


@router.post("/run")
async def declencher_cycle(user: UserPublic = Depends(get_current_user)):
    """Déclenche un cycle de collecte.

    Sort sur le réseau et appelle le LLM : réservé au diagnostic et aux tests. Le fonctionnement
    normal passe par le planificateur (voir `app.veille.scheduler.start_scheduler`).
    """
    return await agent.run_cycle()
