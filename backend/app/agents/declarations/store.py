"""Archivage des jeux de déclarations.

Comme le rapport fiscal, un jeu de brouillons est une PHOTO : il fige ce qui a été déclaré à
un instant donné. Rejouer le calcul plus tard donnerait d'autres chiffres dès qu'une facture
est corrigée ou qu'un virement est capturé — et l'utilisateur doit pouvoir retrouver ce qu'il
a effectivement recopié sur le site officiel.
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional

from pymongo import ASCENDING, DESCENDING

from app.core.mongo import get_db

from .schemas import JeuDeclarations

_lock = threading.Lock()
_initialized = False


def _jeux():
    # Collection distincte de `declarations_generees` (agent `declaration` au singulier) :
    # les deux documents n'ont ni le même schéma ni les mêmes champs, et les mélanger
    # faisait remonter un jeu de brouillons là où l'API promet une `Declaration`.
    return get_db()["jeux_declarations"]


def _ensure_schema() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        _jeux().create_index([("uid", ASCENDING), ("genere_le", DESCENDING)],
                             name="idx_decl_uid_date")
        _jeux().create_index([("uid", ASCENDING), ("id", ASCENDING)],
                             name="idx_decl_id", unique=True)
        _initialized = True


def enregistrer(jeu: JeuDeclarations) -> None:
    _ensure_schema()
    _jeux().insert_one(jeu.model_dump(mode="json"))


def obtenir(uid: str, jeu_id: str) -> Optional[Dict[str, Any]]:
    _ensure_schema()
    return _jeux().find_one({"uid": uid, "id": jeu_id}, {"_id": 0})


def lister(uid: str) -> List[Dict[str, Any]]:
    """Jeux archivés, du plus récent au plus ancien.

    Projection réduite : la liste n'a pas besoin du détail de chaque champ de formulaire.
    """
    _ensure_schema()
    return list(
        _jeux()
        .find(
            {"uid": uid},
            {
                "_id": 0, "id": 1, "date_debut": 1, "date_fin": 1, "genere_le": 1,
                "frequence": 1, "ca_encaisse": 1, "rappels": 1,
                "prelevements.total_a_payer": 1,
            },
        )
        .sort("genere_le", DESCENDING)
    )


def supprimer(uid: str, jeu_id: str) -> bool:
    _ensure_schema()
    return _jeux().delete_one({"uid": uid, "id": jeu_id}).deleted_count > 0
