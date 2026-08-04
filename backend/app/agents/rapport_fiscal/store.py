"""Archivage des rapports fiscaux — la liste consultable côté écran.

Un rapport archivé est une PHOTO : il conserve les chiffres tels qu'ils étaient au moment de
sa génération, y compris le détail du rapprochement. Rejouer le calcul plus tard donnerait un
autre résultat dès qu'une facture est corrigée ou qu'un virement est capturé — d'où le
stockage du résultat complet plutôt que d'un simple identifiant de période.

C'est aussi ce qui rend le PDF réémissible à l'identique : télécharger un rapport de mars ne
doit pas produire les chiffres d'aujourd'hui.
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional

from pymongo import ASCENDING, DESCENDING

from app.core.mongo import get_db

from .schemas import RapportFiscal

_lock = threading.Lock()
_initialized = False


def _rapports():
    return get_db()["rapports_fiscaux"]


def _ensure_schema() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        _rapports().create_index(
            [("uid", ASCENDING), ("genere_le", DESCENDING)], name="idx_rapport_uid_date",
        )
        _rapports().create_index([("uid", ASCENDING), ("id", ASCENDING)],
                                 name="idx_rapport_id", unique=True)
        _initialized = True


def enregistrer(rapport: RapportFiscal) -> None:
    _ensure_schema()
    _rapports().insert_one(rapport.model_dump(mode="json"))


def obtenir(uid: str, rapport_id: str) -> Optional[Dict[str, Any]]:
    _ensure_schema()
    return _rapports().find_one({"uid": uid, "id": rapport_id}, {"_id": 0})


def lister(uid: str) -> List[Dict[str, Any]]:
    """Rapports de l'utilisateur, du plus récent au plus ancien.

    Projection volontairement réduite : la liste n'a pas besoin du détail complet du
    rapprochement, qui peut peser lourd sur une année entière d'encaissements.
    """
    _ensure_schema()
    return list(
        _rapports()
        .find(
            {"uid": uid},
            {
                "_id": 0, "id": 1, "date_debut": 1, "date_fin": 1, "genere_le": 1,
                "ca_retenu": 1, "ca_facture_periode": 1, "ir_calculable": 1,
                "simulation.total_prelevements": 1, "simulation.base_imposable": 1,
                "alertes": 1, "sources": 1,
            },
        )
        .sort("genere_le", DESCENDING)
    )


def supprimer(uid: str, rapport_id: str) -> bool:
    _ensure_schema()
    return _rapports().delete_one({"uid": uid, "id": rapport_id}).deleted_count > 0
