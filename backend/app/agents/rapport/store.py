"""Archivage des rapports d'activité — requêtable par uid et par période (réutilisé par la
déclaration fiscale et la Tax Safety, chantiers suivants)."""

from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone

from pymongo import ASCENDING

from app.agents.rapport.schemas import RapportActivite
from app.core.mongo import get_db

_lock = threading.Lock()
_initialized = False


def _rapports():
    return get_db()["rapports_generes"]


def _ensure_schema() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        _rapports().create_index([("uid", ASCENDING), ("date_debut", ASCENDING)])
        _initialized = True


def nouvel_id() -> str:
    return str(uuid.uuid4())


def enregistrer(rapport: RapportActivite) -> None:
    _ensure_schema()
    _rapports().insert_one(rapport.model_dump(mode="json"))


def obtenir(uid: str, rapport_id: str) -> dict | None:
    _ensure_schema()
    return _rapports().find_one({"uid": uid, "id": rapport_id}, {"_id": 0})


def lister(uid: str) -> list[dict]:
    _ensure_schema()
    return list(_rapports().find({"uid": uid}, {"_id": 0}).sort("date_debut", ASCENDING))
