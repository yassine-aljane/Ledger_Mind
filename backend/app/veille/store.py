"""Persistance de la veille personnalisée.

Trois collections :
  • `veille_nouveautes`      — le catalogue, partagé par tous les utilisateurs
  • `veille_notifications`   — ce qui a été montré à QUI, et si c'est lu
  • `veille_preferences`     — le réglage de chacun (veille active, mode)

L'ancienne veille gardait son dernier rapport en mémoire (`scheduler._dernier_rapport`) : tout
disparaissait au redémarrage, sans historique ni état de lecture. C'est précisément ce que ces
collections corrigent.
"""

from __future__ import annotations

import threading
from datetime import datetime, timedelta

from pymongo import ASCENDING, DESCENDING
from pymongo.collection import Collection

from app.core.mongo import get_db
from app.veille.modele import (
    Nouveaute,
    NouveauteNotifiee,
    PreferencesVeille,
    maintenant,
)

_lock = threading.Lock()
_initialized = False

#: Plafond hebdomadaire de notifications par utilisateur. Au-delà, les nouveautés restent
#: consultables dans l'onglet Veille mais ne déclenchent plus de notification : une limite de
#: confort ne doit jamais faire disparaître de l'information réglementaire.
MAX_NOTIFS_PAR_SEMAINE = 20


def nouveautes() -> Collection:
    return get_db()["veille_nouveautes"]


def notifications() -> Collection:
    return get_db()["veille_notifications"]


def preferences() -> Collection:
    return get_db()["veille_preferences"]


def ensure_schema() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        nouveautes().create_index("id", unique=True)
        nouveautes().create_index([("date_collecte", DESCENDING)])
        nouveautes().create_index("perime")
        # Une notification est unique par couple (utilisateur, nouveauté) : c'est ce qui garantit
        # qu'une nouveauté déjà vue ne sera jamais renotifiée.
        notifications().create_index(
            [("uid", ASCENDING), ("nouveaute_id", ASCENDING)], unique=True
        )
        notifications().create_index([("uid", ASCENDING), ("date_notifiee", DESCENDING)])
        preferences().create_index("uid", unique=True)
        _initialized = True


# ----------------------------------------------------------------------------- Nouveautés


def upsert_nouveaute(item: Nouveaute) -> bool:
    """Enregistre une nouveauté. Renvoie True si elle était inconnue.

    Sur doublon, on ne réécrit pas le contenu : on FUSIONNE les sources et on ne conserve que la
    plus autoritaire en tête. Réécrire écraserait un résumé adossé au Journal officiel par une
    reformulation de presse parue le lendemain.
    """
    ensure_schema()
    existant = nouveautes().find_one({"id": item.id})
    if existant is None:
        nouveautes().insert_one(item.model_dump())
        return True

    connues = {s["url"] for s in existant.get("sources", [])}
    ajouts = [s.model_dump() for s in item.sources if s.url not in connues]
    if ajouts:
        fusion = sorted(existant.get("sources", []) + ajouts, key=lambda s: s.get("autorite", 3))
        nouveautes().update_one(
            {"id": item.id},
            {"$set": {"sources": fusion, "date_verification": maintenant()}},
        )
    else:
        nouveautes().update_one({"id": item.id}, {"$set": {"date_verification": maintenant()}})
    return False


def lister_nouveautes(ids: list[str]) -> dict[str, Nouveaute]:
    ensure_schema()
    if not ids:
        return {}
    docs = nouveautes().find({"id": {"$in": ids}})
    return {d["id"]: Nouveaute.model_validate(d) for d in docs}


def nouveautes_actives(limite: int = 200) -> list[Nouveaute]:
    """Le catalogue courant, la plus récente d'abord."""
    ensure_schema()
    docs = nouveautes().find().sort("date_collecte", DESCENDING).limit(limite)
    return [Nouveaute.model_validate(d) for d in docs]


def marquer_perimees(max_jours: int) -> int:
    """Marque périmé au-delà de `max_jours`. Ne supprime jamais : une mesure ancienne reste vraie
    pour la période qu'elle couvrait, et son retrait silencieux serait une perte d'information."""
    ensure_schema()
    limite = (datetime.now() - timedelta(days=max_jours)).isoformat(timespec="seconds")
    res = nouveautes().update_many(
        {"date_collecte": {"$lt": limite}, "perime": False}, {"$set": {"perime": True}}
    )
    return res.modified_count


# -------------------------------------------------------------------------- Notifications


def deja_notifiees(uid: str) -> set[str]:
    ensure_schema()
    return {d["nouveaute_id"] for d in notifications().find({"uid": uid}, {"nouveaute_id": 1})}


def compte_semaine(uid: str) -> int:
    """Notifications émises pour cet utilisateur sur les 7 derniers jours."""
    ensure_schema()
    depuis = (datetime.now() - timedelta(days=7)).isoformat(timespec="seconds")
    return notifications().count_documents({"uid": uid, "date_notifiee": {"$gte": depuis}})


def enregistrer_notification(notif: NouveauteNotifiee) -> bool:
    """Renvoie False si la nouveauté avait déjà été notifiée à cet utilisateur."""
    ensure_schema()
    from pymongo.errors import DuplicateKeyError

    try:
        notifications().insert_one(notif.model_dump())
        return True
    except DuplicateKeyError:
        return False


def notifications_de(uid: str, non_lues_seulement: bool = False, limite: int = 50) -> list[dict]:
    ensure_schema()
    filtre: dict = {"uid": uid}
    if non_lues_seulement:
        filtre["lue"] = False
    docs = notifications().find(filtre).sort("date_notifiee", DESCENDING).limit(limite)
    return list(docs)


def marquer_lue(uid: str, nouveaute_id: str) -> bool:
    ensure_schema()
    res = notifications().update_one(
        {"uid": uid, "nouveaute_id": nouveaute_id, "lue": False},
        {"$set": {"lue": True, "date_lue": maintenant()}},
    )
    return res.modified_count > 0


def marquer_tout_lu(uid: str) -> int:
    ensure_schema()
    res = notifications().update_many(
        {"uid": uid, "lue": False}, {"$set": {"lue": True, "date_lue": maintenant()}}
    )
    return res.modified_count


# --------------------------------------------------------------------------- Préférences


def get_preferences(uid: str) -> PreferencesVeille:
    ensure_schema()
    doc = preferences().find_one({"uid": uid})
    if doc is None:
        return PreferencesVeille(uid=uid)
    return PreferencesVeille.model_validate(doc)


def set_preferences(uid: str, active: bool | None = None, mode: str | None = None) -> PreferencesVeille:
    ensure_schema()
    courant = get_preferences(uid)
    maj = PreferencesVeille(
        uid=uid,
        active=courant.active if active is None else active,
        mode=courant.mode if mode is None else mode,  # type: ignore[arg-type]
        updated_at=maintenant(),
    )
    preferences().update_one({"uid": uid}, {"$set": maj.model_dump()}, upsert=True)
    return maj
