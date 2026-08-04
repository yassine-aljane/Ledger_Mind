"""Statut de l'ACRE — durée restante et réduction appliquée.

Aucune formule fiscale ici : le TAUX de réduction et la DURÉE viennent des constantes du
moteur (`data/impot_revenu.yaml`, bloc `acre`). Ce module ne fait qu'une arithmétique de
calendrier — quels trimestres civils sont déjà consommés — pour que le rapport puisse dire
« il vous reste 2 trimestres » plutôt qu'un simple « ACRE : oui ».

**Hypothèse assumée** : l'exonération couvre les `trimestres_civils` premiers trimestres
CIVILS à compter de celui du début. C'est la lecture courante de la règle URSSAF ; elle est
signalée comme telle dans le rapport plutôt que présentée comme certaine.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, Optional

from app.agents.impots import constantes as C


def _trimestre(d: date) -> int:
    """Indice absolu du trimestre civil — permet de soustraire deux trimestres."""
    return d.year * 4 + (d.month - 1) // 3


def _date(valeur: Any) -> Optional[date]:
    if not valeur:
        return None
    try:
        return date.fromisoformat(str(valeur)[:10])
    except ValueError:
        return None


def statut(
    acre_active: bool,
    date_debut: Any = None,
    a_la_date: Optional[date] = None,
) -> Dict[str, Any]:
    """État de l'ACRE à une date donnée : active ou non, réduction, trimestres restants.

    `date_debut` absente : on dit que l'ACRE est déclarée active sans pouvoir en calculer la
    fin. C'est plus honnête qu'une date inventée, et le rapport le répercute.
    """
    bloc = C.acre()
    reduction = float(bloc["reduction"])
    duree = int(bloc["trimestres_civils"])

    base: Dict[str, Any] = {
        "active": bool(acre_active),
        "reduction": reduction,
        "reduction_pourcent": round(reduction * 100),
        "duree_trimestres": duree,
        "date_debut": str(date_debut)[:10] if date_debut else None,
        "trimestres_restants": None,
        "date_fin_estimee": None,
        "approximation": bloc.get("approximation"),
        "source": bloc.get("source"),
        "date_verif": bloc.get("date_verif"),
        "hypothese": (
            f"L'exonération couvre les {duree} premiers trimestres civils à compter de celui "
            "du début d'activité."
        ),
    }

    if not acre_active:
        return base

    debut = _date(date_debut)
    if debut is None:
        base["note"] = (
            "Date de début d'ACRE non renseignée : la durée restante ne peut pas être "
            "calculée. La réduction est appliquée sur toute la période demandée."
        )
        return base

    reference = a_la_date or date.today()
    consommes = _trimestre(reference) - _trimestre(debut)
    restants = max(duree - consommes, 0)

    # Fin = dernier jour du trimestre civil qui clôt la période d'exonération.
    fin_indice = _trimestre(debut) + duree - 1
    annee, trimestre = divmod(fin_indice, 4)
    mois_fin = trimestre * 3 + 3
    dernier_jour = 31 if mois_fin in (3, 12) else 30
    base["trimestres_restants"] = restants
    base["date_fin_estimee"] = date(annee, mois_fin, dernier_jour).isoformat()
    base["expiree"] = restants == 0
    if restants == 0:
        base["note"] = (
            "La période d'ACRE est arrivée à son terme : la réduction ne s'applique plus. "
            "Vérifiez que le taux appliqué à cette période est le bon."
        )
    return base
