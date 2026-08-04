"""Valeurs réglementaires et mentions légales de la facturation — lecture seule de `data/`.

Deux fichiers, sans recouvrement :
  * `data/facturation.yaml` — mentions obligatoires, indemnité de recouvrement, seuil de
    dispense du n° de TVA intracommunautaire, délais de paiement, numérotation ;
  * `data/seuils.yaml`      — seuils de franchise en base de TVA (fichier préexistant).

Rien n'est codé en dur ici : le texte affiché sur une facture est celui écrit dans le YAML,
mot pour mot. Une valeur absente lève plutôt que de retomber sur un défaut silencieux — une
mention légale inventée est pire qu'une facture refusée.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict, List

import yaml

from app.agents.guidance.roadmap import seuils as seuils_projet
from app.core.paths import FACTURATION_YAML


class MentionManquante(KeyError):
    """Une mention ou un montant réglementaire est absent des fichiers de données."""


@lru_cache(maxsize=1)
def _data() -> Dict[str, Any]:
    return yaml.safe_load(FACTURATION_YAML.read_text(encoding="utf-8"))


def reload() -> None:
    """Vide le cache (tests, ou modification du YAML à chaud)."""
    _data.cache_clear()


def _bloc(nom: str) -> Dict[str, Any]:
    bloc = _data().get(nom)
    if bloc is None:
        raise MentionManquante(f"Bloc absent de data/facturation.yaml : {nom}")
    return bloc


def _valeur(bloc: str, cle: str) -> Any:
    v = _bloc(bloc).get(cle)
    if v is None:
        raise MentionManquante(f"Valeur absente de data/facturation.yaml : {bloc}.{cle}")
    return v


def source_principale() -> str:
    return str(_valeur_racine("source_principale"))


def _valeur_racine(cle: str) -> Any:
    v = _data().get(cle)
    if v is None:
        raise MentionManquante(f"Valeur absente de data/facturation.yaml : {cle}")
    return v


# -- Indemnité de recouvrement ----------------------------------------------
def indemnite_recouvrement_mention() -> str:
    return str(_valeur("indemnite_recouvrement", "mention"))


def indemnite_due_aux_particuliers() -> bool:
    """Faux : l'indemnité forfaitaire ne se mentionne qu'entre professionnels."""
    return bool(_valeur("indemnite_recouvrement", "due_aux_particuliers"))


# -- TVA ---------------------------------------------------------------------
def seuil_dispense_tva_intracom() -> float:
    return float(_valeur("tva_intracommunautaire", "seuil_dispense_ht"))


def mention_franchise_tva() -> str:
    return str(_valeur("tva", "mention_franchise"))


def mention_autoliquidation() -> str:
    return str(_valeur("tva", "mention_autoliquidation"))


def seuils_franchise_tva() -> Dict[str, Any]:
    """Seuils de franchise en base, lus dans le fichier projet préexistant."""
    return seuils_projet.bloc("tva_franchise")


# -- Autres mentions ---------------------------------------------------------
def mention_penalites() -> str:
    return str(_valeur("penalites_retard", "mention"))


def mention_escompte_neant() -> str:
    return str(_valeur("mentions", "escompte_neant"))


def mention_association_agreee() -> str:
    return str(_valeur("mentions", "association_agreee"))


def mention_garantie_legale() -> str:
    return str(_valeur("mentions", "garantie_legale"))


# -- Paiement et numérotation ------------------------------------------------
def delai_paiement_defaut() -> int:
    return int(_valeur("paiement", "delai_defaut_jours"))


def delai_paiement_maximum() -> int:
    return int(_valeur("paiement", "delai_maximum_jours"))


def prefixe(type_document: str) -> str:
    cle = "prefixe_avoir" if type_document == "avoir" else "prefixe_facture"
    return str(_valeur("numerotation", cle))


def format_numero() -> str:
    return str(_valeur("numerotation", "format"))


# -- Traçabilité -------------------------------------------------------------
def provenance() -> Dict[str, Any]:
    """Année, date de contrôle et valeurs signalées comme à revérifier en direct."""
    data = _data()
    a_verifier: List[str] = [
        nom for nom, bloc in data.items()
        if isinstance(bloc, dict) and bloc.get("verifier_en_direct")
    ]
    return {
        "annee": data.get("annee"),
        "date_verif": data.get("date_verif"),
        "fichier": "data/facturation.yaml",
        "a_verifier_en_direct": sorted(a_verifier),
        "seuils_tva": {
            "fichier": "data/seuils.yaml",
            "date_verif": seuils_projet.date_verif(),
        },
    }
