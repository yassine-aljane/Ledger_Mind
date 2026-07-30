"""Persistance des statuts d'échéances — uniquement la confirmation manuelle « Marquer comme
payé » (voir generer_agenda). Le statut "regularisee" (vert) n'a pas d'autre origine : LedgerMind
ne peut pas savoir qu'un paiement officiel a eu lieu, seul l'utilisateur le confirme après être
passé par le portail officiel.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone

from pymongo import ASCENDING

from app.core.mongo import get_db

_lock = threading.Lock()
_initialized = False


def _statuts():
    return get_db()["echeances_statuts"]


def _ensure_schema() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        _statuts().create_index(
            [("uid", ASCENDING), ("obligation_id", ASCENDING), ("periode", ASCENDING)],
            unique=True,
        )
        _initialized = True


def marquer_regularisee(uid: str, obligation_id: str, periode: str) -> None:
    _ensure_schema()
    _statuts().update_one(
        {"uid": uid, "obligation_id": obligation_id, "periode": periode},
        {"$set": {"regularisee_le": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )


def est_regularisee(uid: str, obligation_id: str, periode: str) -> bool:
    _ensure_schema()
    return _statuts().find_one(
        {"uid": uid, "obligation_id": obligation_id, "periode": periode}
    ) is not None
