"""Chargement de la source de vérité unique des seuils/taux fiscaux (data/seuils.yaml).

Aucune valeur fiscale n'est codée en dur ailleurs : tout passe par ce module.
Le YAML est lu une seule fois (cache mémoire).

Chaque bloc du YAML porte sa `source` (URL officielle) et sa `date_verif`, de sorte
que l'UI et le PDF peuvent afficher la provenance et la fraîcheur de chaque chiffre.
"""
from __future__ import annotations

from datetime import date
from functools import lru_cache
from pathlib import Path

import yaml

# data/seuils.yaml à la racine du projet (…/app/roadmap/seuils.py -> racine = parents[1])
_YAML_PATH = Path(__file__).resolve().parents[1] / "data" / "seuils.yaml"


@lru_cache(maxsize=1)
def _load() -> dict:
    return yaml.safe_load(_YAML_PATH.read_text(encoding="utf-8"))


def bloc(nom: str) -> dict:
    """Renvoie un bloc de premier niveau (ex. 'micro', 'tva_franchise', 'micro_social')."""
    return _load()[nom]


def annee() -> int:
    return int(_load()["annee"])


def date_verif() -> str:
    return str(_load()["date_verif"])


def jours_depuis(date_str: str | None) -> int | None:
    """Nombre de jours écoulés depuis une date ISO (YYYY-MM-DD). None si illisible."""
    if not date_str:
        return None
    try:
        d = date.fromisoformat(str(date_str)[:10])
    except ValueError:
        return None
    return (date.today() - d).days


def fraicheur(date_str: str | None, max_days: int) -> dict:
    """Renvoie un drapeau de fraîcheur pour une date de vérification donnée."""
    jours = jours_depuis(date_str)
    return {
        "date_verif": date_str,
        "jours": jours,
        "max_days": max_days,
        "perime": bool(jours is not None and jours > max_days),
    }
