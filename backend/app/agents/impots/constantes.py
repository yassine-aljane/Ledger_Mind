"""Constantes du moteur de calcul d'impôt — lecture seule des fichiers `data/`.

Deux sources, complémentaires et sans recouvrement :

  * `data/seuils.yaml`      — abattements, plafonds micro, taux de cotisations
                              sociales, taux et seuil du versement libératoire.
                              Fichier PRÉEXISTANT du projet, sourcé et daté.
  * `data/impot_revenu.yaml` — barème de l'IR, quotient familial, décote, CFP,
                              ACRE. Ajouté pour le moteur de calcul.

Rien n'est codé en dur ici : ce module ne fait que lire, normaliser et exposer.
Une valeur absente lève `ConstanteManquante` plutôt que de retomber sur un
défaut silencieux — un impôt calculé avec un taux inventé serait pire qu'un
calcul refusé.
"""

from __future__ import annotations

from enum import Enum
from functools import lru_cache
from typing import Any, Dict, List, Optional

import yaml

from app.agents.guidance.roadmap import seuils as seuils_projet
from app.core.paths import DECLARATIONS_YAML, IMPOT_REVENU_YAML


class ConstanteManquante(KeyError):
    """Une constante attendue est absente des fichiers de données."""


class CategorieFiscale(str, Enum):
    """Catégorie d'imposition du chiffre d'affaires micro."""

    bic_vente = "BIC_VENTE"        # vente de marchandises, fourniture de logement
    bic_service = "BIC_SERVICE"    # prestations de services relevant des BIC
    bnc = "BNC"                    # prestations libérales


class CaisseBNC(str, Enum):
    """Caisse d'affiliation d'un BNC : le taux de cotisations en dépend."""

    regime_general = "REGIME_GENERAL"   # SSI
    cipav = "CIPAV"


# Correspondance entre les catégories du moteur et les clés de `seuils.yaml`,
# dont le nommage est antérieur à ce module.
_CLE_MICRO = {
    CategorieFiscale.bic_vente: "bic_vente",
    CategorieFiscale.bic_service: "bic_services",
    CategorieFiscale.bnc: "bnc",
}
_CLE_SOCIAL = {
    CategorieFiscale.bic_vente: "vente",
    CategorieFiscale.bic_service: "services_bic",
}
_CLE_VL = {
    CategorieFiscale.bic_vente: "vente",
    CategorieFiscale.bic_service: "services_bic",
    CategorieFiscale.bnc: "bnc",
}
_CLE_CFP = {
    CategorieFiscale.bic_vente: "vente",
    CategorieFiscale.bic_service: "services_bic",
}


@lru_cache(maxsize=1)
def _ir() -> Dict[str, Any]:
    return yaml.safe_load(IMPOT_REVENU_YAML.read_text(encoding="utf-8"))


def reload() -> None:
    """Vide les caches des trois fichiers (tests, ou modification à chaud)."""
    _ir.cache_clear()
    _declarations.cache_clear()
    seuils_projet.reload()


def _exiger(valeur: Any, chemin: str) -> Any:
    if valeur is None:
        raise ConstanteManquante(f"Constante absente des fichiers de données : {chemin}")
    return valeur


# -- Abattement forfaitaire --------------------------------------------------
def abattement_taux(categorie: CategorieFiscale) -> float:
    bloc = seuils_projet.bloc("micro")[_CLE_MICRO[categorie]]
    return float(_exiger(bloc.get("abattement"), f"micro.{_CLE_MICRO[categorie]}.abattement"))


def abattement_minimum() -> float:
    """Plancher d'abattement, commun aux trois catégories."""
    bnc = seuils_projet.bloc("micro")["bnc"]
    return float(_exiger(bnc.get("abattement_min"), "micro.bnc.abattement_min"))


def abattement_minimum_mixte() -> float:
    """Plancher doublé en activité mixte."""
    mixte = seuils_projet.bloc("micro")["mixte"]
    return float(_exiger(mixte.get("abattement_min"), "micro.mixte.abattement_min"))


def plafond_ca(categorie: CategorieFiscale) -> float:
    bloc = seuils_projet.bloc("micro")[_CLE_MICRO[categorie]]
    return float(_exiger(bloc.get("seuil"), f"micro.{_CLE_MICRO[categorie]}.seuil"))


# -- Cotisations sociales ----------------------------------------------------
def taux_social(categorie: CategorieFiscale, caisse: Optional[CaisseBNC] = None) -> float:
    social = seuils_projet.bloc("micro_social")
    if categorie is CategorieFiscale.bnc:
        cle = "bnc_cipav" if caisse is CaisseBNC.cipav else "bnc_regime_general"
    else:
        cle = _CLE_SOCIAL[categorie]
    return float(_exiger(social.get(cle), f"micro_social.{cle}"))


def acre() -> Dict[str, Any]:
    return dict(_exiger(_ir().get("acre"), "acre"))


# -- Contribution à la formation professionnelle -----------------------------
def taux_cfp(categorie: CategorieFiscale, caisse: Optional[CaisseBNC] = None) -> float:
    cfp = _exiger(_ir().get("cfp"), "cfp")
    if categorie is CategorieFiscale.bnc:
        cle = "bnc_cipav" if caisse is CaisseBNC.cipav else "bnc_regime_general"
    else:
        cle = _CLE_CFP[categorie]
    return float(_exiger(cfp.get(cle), f"cfp.{cle}"))


@lru_cache(maxsize=1)
def _declarations() -> Dict[str, Any]:
    """Constantes propres aux obligations déclaratives (data/declarations.yaml)."""
    return yaml.safe_load(DECLARATIONS_YAML.read_text(encoding="utf-8"))


def declarations() -> Dict[str, Any]:
    return _declarations()


def taux_tfcc(categorie: CategorieFiscale) -> float:
    """Taxe pour frais de chambre consulaire — BIC uniquement.

    Un BNC n'est inscrit qu'au RNE, jamais au RCS : la TFCC ne le concerne pas. Renvoyer 0
    est donc un RÉSULTAT, pas une valeur manquante.
    """
    bloc = _exiger(_declarations().get("tfcc"), "tfcc")
    return float(_exiger(bloc.get(categorie.value, {}).get("taux"), f"tfcc.{categorie.value}"))


def tfcc_bloc() -> Dict[str, Any]:
    return _exiger(_declarations().get("tfcc"), "tfcc")


def cfp_exoneration() -> Dict[str, Any]:
    """Règle d'exonération de CFP la première année. Le TAUX vit dans `cfp`."""
    return _exiger(_declarations().get("cfp_exoneration"), "cfp_exoneration")


def seuil_cfp_premiere_annee() -> float:
    return float(_exiger(
        cfp_exoneration().get("premiere_annee_et_ca_inferieur_a"),
        "cfp_exoneration.premiere_annee_et_ca_inferieur_a",
    ))


# -- Versement libératoire ---------------------------------------------------
def taux_versement_liberatoire(categorie: CategorieFiscale) -> float:
    vl = seuils_projet.bloc("versement_liberatoire")
    cle = _CLE_VL[categorie]
    return float(_exiger(vl.get(cle), f"versement_liberatoire.{cle}"))


def rfr_maximum_par_part() -> float:
    """Plafond de revenu fiscal de référence (N-2), par part, ouvrant l'option."""
    vl = seuils_projet.bloc("versement_liberatoire")
    return float(_exiger(vl.get("rfr_max_par_part"), "versement_liberatoire.rfr_max_par_part"))


# -- Barème de l'impôt sur le revenu -----------------------------------------
def bareme_tranches() -> List[Dict[str, Any]]:
    """Tranches du barème, du plancher le plus bas au plus haut."""
    bareme = _exiger(_ir().get("bareme"), "bareme")
    tranches = _exiger(bareme.get("tranches"), "bareme.tranches")
    return [dict(t) for t in tranches]


def plafond_demi_part() -> float:
    qf = _exiger(_ir().get("quotient_familial"), "quotient_familial")
    return float(_exiger(qf.get("plafond_demi_part"), "quotient_familial.plafond_demi_part"))


def parts_de_base(en_couple: bool) -> float:
    qf = _exiger(_ir().get("quotient_familial"), "quotient_familial")
    cle = "parts_base_couple" if en_couple else "parts_base_seul"
    return float(_exiger(qf.get(cle), f"quotient_familial.{cle}"))


def decote(en_couple: bool) -> tuple[float, float]:
    """Renvoie `(montant, taux)` de la décote applicable."""
    d = _exiger(_ir().get("decote"), "decote")
    cle = "couple" if en_couple else "celibataire"
    return float(_exiger(d.get(cle), f"decote.{cle}")), float(_exiger(d.get("taux"), "decote.taux"))


# -- Provenance --------------------------------------------------------------
def provenance() -> Dict[str, Any]:
    """Année de validité et fraîcheur des deux fichiers de constantes.

    Remonté avec chaque calcul : un montant d'impôt sans la date de ses barèmes
    n'est pas vérifiable.
    """
    ir = _ir()
    return {
        "seuils": {
            "annee": seuils_projet.annee(),
            "date_verif": seuils_projet.date_verif(),
            "fichier": "data/seuils.yaml",
        },
        "impot_revenu": {
            "annee": ir.get("annee"),
            "date_verif": ir.get("date_verif"),
            "verifie": bool(ir.get("verifie")),
            "fichier": "data/impot_revenu.yaml",
        },
    }
