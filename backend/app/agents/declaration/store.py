"""Archivage horodaté des déclarations préparées — requêtable par uid, réutilisable par la
Tax Safety (chantier suivant)."""

from __future__ import annotations

import threading
from datetime import datetime, timezone

from pymongo import ASCENDING

from app.agents.declaration.schemas import Declaration
from app.core.mongo import get_db

_lock = threading.Lock()
_initialized = False


def _declarations():
    return get_db()["declarations_generees"]


def _ensure_schema() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        _declarations().create_index([("uid", ASCENDING), ("date_debut", ASCENDING)])
        _initialized = True


def enregistrer(declaration: Declaration) -> None:
    _ensure_schema()
    _declarations().update_one(
        {"uid": declaration.uid, "id": declaration.id},
        {"$set": declaration.model_dump(mode="json")},
        upsert=True,
    )


def obtenir(uid: str, declaration_id: str) -> dict | None:
    _ensure_schema()
    return _declarations().find_one({"uid": uid, "id": declaration_id}, {"_id": 0})


def lister(uid: str) -> list[dict]:
    _ensure_schema()
    return list(_declarations().find({"uid": uid}, {"_id": 0}).sort("date_debut", ASCENDING))


def marquer_revue(uid: str, declaration_id: str) -> dict | None:
    """Étape 3.2 : l'utilisateur confirme avoir relu champ par champ. Rien n'est transmis pour
    autant — seul le statut passe de "brouillon" à "revue"."""
    _ensure_schema()
    horodatage = datetime.now(timezone.utc).isoformat()
    _declarations().update_one(
        {"uid": uid, "id": declaration_id},
        {"$set": {"statut": "revue", "revue_le": horodatage}},
    )
    return obtenir(uid, declaration_id)
