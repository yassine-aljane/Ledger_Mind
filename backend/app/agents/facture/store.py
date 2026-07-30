"""Persistance des factures émises — numérotation séquentielle atomique, archivage requêtable.

La numérotation « sans rupture » est une obligation légale (fiche F31808) : deux requêtes
concurrentes ne doivent jamais obtenir le même numéro, et aucun numéro ne doit être « sauté »
par un compteur non atomique. On utilise `find_one_and_update` avec `$inc`, atomique côté Mongo.

Collection distincte de `invoices` (app.agents.capture) : celle-ci porte les factures REÇUES
(fournisseurs) ; celle-ci porte les factures ÉMISES par l'utilisateur à ses propres clients.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone

from pymongo import ASCENDING, ReturnDocument

from app.agents.facture.schemas import Facture
from app.core.mongo import get_db

_lock = threading.Lock()
_initialized = False


def _factures():
    return get_db()["factures_emises"]


def _compteurs():
    return get_db()["factures_compteurs"]


def _ensure_schema() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        _factures().create_index([("uid", ASCENDING), ("numero", ASCENDING)], unique=True)
        _factures().create_index([("uid", ASCENDING), ("date_emission", ASCENDING)])
        _initialized = True


def prochain_numero(uid: str) -> str:
    """Réserve atomiquement le prochain numéro de séquence pour cet utilisateur.

    Format FA-<année>-<compteur> (ex FA-2026-000042) : l'année ne remet PAS le compteur à zéro
    (la continuité de la séquence prime sur l'esthétique — casser la suite serait illégal).
    """
    _ensure_schema()
    doc = _compteurs().find_one_and_update(
        {"uid": uid},
        {"$inc": {"valeur": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    annee = datetime.now(timezone.utc).year
    return f"FA-{annee}-{doc['valeur']:06d}"


def enregistrer(facture: Facture) -> None:
    _ensure_schema()
    _factures().insert_one(facture.model_dump(mode="json"))


def obtenir(uid: str, facture_id: str) -> dict | None:
    _ensure_schema()
    return _factures().find_one({"uid": uid, "id": facture_id}, {"_id": 0})


def lister(uid: str, *, depuis: str | None = None, jusqua: str | None = None) -> list[dict]:
    """Factures d'un utilisateur, filtrables par période (date d'émission ISO) — réutilisé par
    les rapports d'activité et la déclaration fiscale (chantiers 2 et 3)."""
    _ensure_schema()
    requete: dict = {"uid": uid}
    if depuis or jusqua:
        borne: dict = {}
        if depuis:
            borne["$gte"] = depuis
        if jusqua:
            borne["$lte"] = jusqua
        requete["date_emission"] = borne
    return list(_factures().find(requete, {"_id": 0}).sort("numero", ASCENDING))
