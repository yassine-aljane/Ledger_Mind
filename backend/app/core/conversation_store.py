"""Mémoire conversationnelle de l'agent de guidance — portée sur MongoDB.

Remplace le stockage SQLite d'origine (`agent_NoSiren/app/memory/store.py`) par la base
MongoDB déjà utilisée par le projet (`app.core.mongo`). L'API publique est identique à celle
du module d'origine : les agents n'ont pas été modifiés pour ce portage.

Collections (préfixe `guidance_` pour ne pas empiéter sur `sessions` / `users`) :
  • guidance_conversations(id, uid, type, title, created_at, updated_at)
      `type` = 'guidance' | 'pedagogue' — l'historique est filtré par interface.
  • guidance_messages(conversation_id, role, content, sources, created_at)
  • guidance_profiles(uid, ...champs..., updated_at) — profil PARTAGÉ par utilisateur.
  • guidance_roadmaps(conversation_id, roadmap, checked, updated_at)

Le profil est indexé par `uid` (l'identifiant du compte authentifié) et non par conversation :
ce qui est dit dans un espace reste connu de l'autre.
"""

from __future__ import annotations

import asyncio
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from pymongo import ASCENDING, DESCENDING

from app.core.mongo import get_db

_lock = threading.Lock()
_initialized = False

_TTL_DAYS = 30
_DEFAULT_UID = "demo"

# Champs du profil de guidance. Le SET est fermé : rien d'autre n'est persisté.
PROFILE_FIELDS = (
    "activite", "ca_estime", "vend_produits", "recoit_cadeaux", "anciennete",
    "situation_actuelle", "statut_actuel", "regime_actuel", "deja_immatricule",
    "ca_prestations", "ca_vente", "remuneration_nature", "devise", "choix_parcours",
    "ca_n_1_au_dessus_seuil",
)
_BOOL_FIELDS = {"vend_produits", "recoit_cadeaux", "deja_immatricule", "ca_n_1_au_dessus_seuil"}


# --------------------------------------------------------------------------- Infrastructure
def _conversations():
    return get_db()["guidance_conversations"]


def _messages():
    return get_db()["guidance_messages"]


def _profiles():
    return get_db()["guidance_profiles"]


def _roadmaps():
    return get_db()["guidance_roadmaps"]


def _ensure_schema() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        _conversations().create_index("id", unique=True)
        _conversations().create_index([("uid", ASCENDING), ("type", ASCENDING),
                                       ("updated_at", DESCENDING)])
        _messages().create_index([("conversation_id", ASCENDING), ("created_at", ASCENDING)])
        _profiles().create_index("uid", unique=True)
        _roadmaps().create_index("conversation_id", unique=True)
        _initialized = True


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(moment: Any) -> str:
    return moment.isoformat() if isinstance(moment, datetime) else str(moment or "")


def _normaliser(profil: dict) -> dict:
    """Cohérence déterministe du profil : le CA total = prestations + ventes dès que les deux
    composantes sont connues ; la rémunération en nature ne dépasse jamais les prestations.
    (Les cadeaux ne sont PAS une catégorie de CA : leur valeur est incluse dans les prestations.)"""
    derived: dict = {}
    presta, vente = profil.get("ca_prestations"), profil.get("ca_vente")
    rem = profil.get("remuneration_nature")
    if presta is not None and vente is not None:
        total = presta + vente
        if profil.get("ca_estime") != total:
            derived["ca_estime"] = total
    if rem is not None and presta is not None and rem > presta:
        derived["remuneration_nature"] = presta
    return derived


def _doc_to_profil(doc: dict | None) -> dict:
    if not doc:
        return {}
    return {
        k: (bool(doc[k]) if k in _BOOL_FIELDS and doc.get(k) is not None else doc[k])
        for k in PROFILE_FIELDS
        if doc.get(k) is not None
    }


# --------------------------------------------------------------------------- Conversations
def purge_expirees() -> int:
    """Supprime les conversations inactives depuis plus de `_TTL_DAYS`, et leurs dépendances.

    Purge aussi les profils anonymes (`uid` préfixé `anon-`, voir `app/api/guidance.py`) inactifs
    depuis le même délai : chacun est isolé par visiteur, donc rien à perdre à les nettoyer — au
    contraire d'un profil de compte authentifié, qui doit persister indéfiniment.
    """
    _ensure_schema()
    limite = _now() - timedelta(days=_TTL_DAYS)
    ids = [row["id"] for row in _conversations().find({"updated_at": {"$lt": limite}}, {"id": 1})]
    if ids:
        _messages().delete_many({"conversation_id": {"$in": ids}})
        _roadmaps().delete_many({"conversation_id": {"$in": ids}})
        _conversations().delete_many({"id": {"$in": ids}})
    _profiles().delete_many({"uid": {"$regex": "^anon-"}, "updated_at": {"$lt": limite}})
    return len(ids)


def ensure_session(session_id: str | None = None, uid: str = _DEFAULT_UID,
                   type: str = "guidance") -> str:
    _ensure_schema()
    purge_expirees()
    sid = session_id or str(uuid.uuid4())
    uid = uid or _DEFAULT_UID
    now = _now()
    existing = _conversations().find_one({"id": sid}, {"id": 1})
    if existing:
        _conversations().update_one({"id": sid}, {"$set": {"updated_at": now}})
    else:
        _conversations().insert_one({"id": sid, "uid": uid, "type": type, "title": None,
                                     "created_at": now, "updated_at": now})
        _profiles().update_one({"uid": uid}, {"$setOnInsert": {"updated_at": now}}, upsert=True)
    return sid


def session_meta(session_id: str) -> dict | None:
    _ensure_schema()
    doc = _conversations().find_one({"id": session_id}, {"_id": 0})
    if not doc:
        return None
    return {"id": doc["id"], "uid": doc.get("uid"), "type": doc.get("type"),
            "title": doc.get("title"), "created_at": _iso(doc.get("created_at")),
            "updated_at": _iso(doc.get("updated_at"))}


def _uid_of(session_id: str) -> str:
    doc = _conversations().find_one({"id": session_id}, {"uid": 1})
    return (doc or {}).get("uid") or _DEFAULT_UID


def rename_session(session_id: str, title: str) -> bool:
    _ensure_schema()
    res = _conversations().update_one(
        {"id": session_id}, {"$set": {"title": title.strip()[:120], "updated_at": _now()}})
    return res.matched_count > 0


def list_sessions(uid: str = _DEFAULT_UID, type: str | None = None) -> list[dict]:
    """Conversations d'un utilisateur (filtrées par interface), la plus récente en premier."""
    _ensure_schema()
    requete: dict = {"uid": uid or _DEFAULT_UID}
    if type:
        requete["type"] = type
    out: list[dict] = []
    for doc in _conversations().find(requete, {"_id": 0}).sort("updated_at", DESCENDING):
        premier = _messages().find_one({"conversation_id": doc["id"], "role": "user"},
                                       {"content": 1}, sort=[("created_at", ASCENDING)])
        apercu = ((premier or {}).get("content") or "").strip().replace("\n", " ")
        titre = doc.get("title") or (" ".join(apercu.split()[:6]) if apercu else "Nouvelle conversation")
        out.append({"id": doc["id"], "type": doc.get("type"), "title": titre,
                    "apercu": apercu[:90], "date": _iso(doc.get("updated_at"))})
    return out


def delete_session(session_id: str) -> bool:
    _ensure_schema()
    if not _conversations().find_one({"id": session_id}, {"id": 1}):
        return False
    _messages().delete_many({"conversation_id": session_id})
    _roadmaps().delete_many({"conversation_id": session_id})
    _conversations().delete_one({"id": session_id})
    return True


# --------------------------------------------------------------------------- Profil (par uid)
def get_profil(uid: str = _DEFAULT_UID) -> dict:
    _ensure_schema()
    return _doc_to_profil(_profiles().find_one({"uid": uid or _DEFAULT_UID}, {"_id": 0}))


def get_profil_by_session(session_id: str) -> dict:
    _ensure_schema()
    return get_profil(_uid_of(session_id))


def patch_profil(uid: str, valeurs: dict) -> dict:
    """Applique une mise à jour partielle, puis la normalisation déterministe."""
    _ensure_schema()
    uid = uid or _DEFAULT_UID
    valeurs = {k: v for k, v in valeurs.items() if k in PROFILE_FIELDS and v is not None}
    maj: dict = {"updated_at": _now()}
    maj.update(valeurs)
    _profiles().update_one({"uid": uid}, {"$set": maj}, upsert=True)

    profil = get_profil(uid)
    derived = _normaliser(profil)
    if derived:
        _profiles().update_one({"uid": uid}, {"$set": {**derived, "updated_at": _now()}})
        profil = get_profil(uid)
    return profil


def clear_profil_field(uid: str, field: str) -> dict:
    """Efface un champ (le remet à vide) — pour l'effacement manuel depuis la fiche de statut."""
    _ensure_schema()
    uid = uid or _DEFAULT_UID
    if field in PROFILE_FIELDS:
        _profiles().update_one({"uid": uid},
                               {"$unset": {field: ""}, "$set": {"updated_at": _now()}})
    return get_profil(uid)


# --------------------------------------------------------------------------- Messages
def add_message(session_id: str, role: str, content: str, sources: list | None = None) -> None:
    _ensure_schema()
    now = _now()
    _messages().insert_one({"conversation_id": session_id, "role": role, "content": content,
                            "sources": sources or [], "created_at": now})
    _conversations().update_one({"id": session_id}, {"$set": {"updated_at": now}})
    # Titre automatique depuis le premier message utilisateur (aucun appel LLM).
    if role == "user":
        doc = _conversations().find_one({"id": session_id}, {"title": 1})
        if doc and not doc.get("title"):
            titre = " ".join(content.strip().split()[:6])[:120]
            _conversations().update_one({"id": session_id}, {"$set": {"title": titre}})


def history(session_id: str, limit: int | None = None) -> list[dict]:
    _ensure_schema()
    docs = list(_messages().find({"conversation_id": session_id}, {"_id": 0})
                .sort("created_at", ASCENDING))
    out = [{"role": d["role"], "content": d["content"], "sources": d.get("sources") or [],
            "created_at": _iso(d.get("created_at"))} for d in docs]
    return out[-limit:] if limit else out


# --------------------------------------------------------------------------- Roadmap
def save_roadmap(session_id: str, roadmap: dict | None = None, checked: dict | None = None) -> None:
    """Persiste la roadmap générée et/ou l'état coché, côté serveur, avec la conversation."""
    _ensure_schema()
    maj: dict = {"updated_at": _now()}
    if roadmap is not None:
        maj["roadmap"] = roadmap
    if checked is not None:
        maj["checked"] = checked
    _roadmaps().update_one({"conversation_id": session_id},
                           {"$set": maj, "$setOnInsert": {"conversation_id": session_id}},
                           upsert=True)


def get_roadmap(session_id: str) -> dict | None:
    _ensure_schema()
    doc = _roadmaps().find_one({"conversation_id": session_id}, {"_id": 0})
    if not doc:
        return None
    return {"roadmap": doc.get("roadmap"), "checked": doc.get("checked") or {}}


# --------------------------------------------------------------------------- Variantes async
async def async_ensure_session(session_id: str | None = None, uid: str = _DEFAULT_UID,
                               type: str = "guidance") -> str:
    return await asyncio.to_thread(ensure_session, session_id, uid, type)


async def async_list_sessions(uid: str, type: str | None = None) -> list[dict]:
    return await asyncio.to_thread(list_sessions, uid, type)


async def async_history(session_id: str, limit: int | None = None) -> list[dict]:
    return await asyncio.to_thread(history, session_id, limit)


async def async_get_profil(uid: str) -> dict:
    return await asyncio.to_thread(get_profil, uid)


async def async_patch_profil(uid: str, valeurs: dict) -> dict:
    return await asyncio.to_thread(patch_profil, uid, valeurs)
