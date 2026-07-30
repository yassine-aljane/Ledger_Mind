"""Scheduler — résout, pour chaque `type_date` déclaré dans le Rule Engine, la prochaine
occurrence (date exacte OU fenêtre indicative si la règle officielle est elle-même une fenêtre,
dépend d'un jour ouvré non calculable ici, ou d'un département inconnu du profil).

Principe non négociable : aucune date n'est inventée. Une règle "jour ouvré" (CA12, DES) reste une
fenêtre indicative plutôt qu'un jour calendaire présenté comme exact ; un département inconnu (IR
annuelle) reste une fenêtre "mai-juin" plutôt qu'une date de zone fabriquée.
"""

from __future__ import annotations

import calendar
from datetime import date
from typing import NamedTuple


class Occurrence(NamedTuple):
    periode: str
    date_limite: date | None
    fenetre_indicative: str | None


def _dernier_jour_du_mois(annee: int, mois: int) -> date:
    return date(annee, mois, calendar.monthrange(annee, mois)[1])


def _mois_precedent(d: date) -> tuple[int, int]:
    if d.month == 1:
        return d.year - 1, 12
    return d.year, d.month - 1


_MOIS_FR = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]


def _libelle_periode_mois(annee: int, mois: int) -> str:
    return f"{_MOIS_FR[mois - 1]} {annee}"


def _roule_si_weekend(d: date) -> date:
    """Reporte au jour ouvré suivant si la date tombe un samedi/dimanche (pratique administrative
    usuelle en France, appliquée explicitement par l'administration pour la CFE)."""
    while d.weekday() >= 5:  # 5=samedi, 6=dimanche
        d = date.fromordinal(d.toordinal() + 1)
    return d


def urssaf(aujourdhui: date, periodicite: str | None) -> Occurrence:
    if periodicite == "trimestrielle":
        echeances_fixes = [(1, 31), (4, 30), (7, 31), (10, 31)]
        candidats = [date(aujourdhui.year, m, j) for m, j in echeances_fixes]
        candidats += [date(aujourdhui.year + 1, 1, 31)]
        prochaine = min(d for d in candidats if d >= aujourdhui)
        annee_trim, mois_debut = _mois_precedent(prochaine)
        trimestre = (mois_debut - 1) // 3 + 1
        return Occurrence(f"T{trimestre} {annee_trim}", prochaine, None)
    # Mensuelle (par défaut, y compris si la périodicité n'est pas encore connue) : on déclare le
    # mois précédent avant la fin du mois courant.
    limite = _dernier_jour_du_mois(aujourdhui.year, aujourdhui.month)
    annee_periode, mois_periode = _mois_precedent(aujourdhui)
    return Occurrence(_libelle_periode_mois(annee_periode, mois_periode), limite, None)


def tva_acompte_juillet(aujourdhui: date, _periodicite: str | None = None) -> Occurrence:
    annee = aujourdhui.year if aujourdhui <= date(aujourdhui.year, 7, 24) else aujourdhui.year + 1
    return Occurrence(str(annee), None, f"entre le 15 et le 24 juillet {annee}")


def tva_acompte_decembre(aujourdhui: date, _periodicite: str | None = None) -> Occurrence:
    annee = aujourdhui.year if aujourdhui <= date(aujourdhui.year, 12, 24) else aujourdhui.year + 1
    return Occurrence(str(annee), None, f"entre le 15 et le 24 décembre {annee}")


def tva_ca12_annuelle(aujourdhui: date, _periodicite: str | None = None) -> Occurrence:
    annee = aujourdhui.year if aujourdhui <= date(aujourdhui.year, 5, 5) else aujourdhui.year + 1
    return Occurrence(str(annee - 1), None, f"début mai {annee} (2ᵉ jour ouvré après le 1er mai)")


def tva_reel_normal(aujourdhui: date, _periodicite: str | None = None) -> Occurrence:
    annee_periode, mois_periode = _mois_precedent(aujourdhui)
    return Occurrence(
        _libelle_periode_mois(annee_periode, mois_periode), None,
        "échéance mensuelle variable selon votre SIREN — voir votre calendrier fiscal personnel",
    )


def ir_annuelle(aujourdhui: date, _periodicite: str | None = None) -> Occurrence:
    annee_revenus = aujourdhui.year - 1 if aujourdhui.month <= 4 else aujourdhui.year
    annee_campagne = annee_revenus + 1
    return Occurrence(str(annee_revenus), None, f"mai-juin {annee_campagne}")


def cfe(aujourdhui: date, date_creation: date | None) -> Occurrence | None:
    annee = aujourdhui.year if aujourdhui <= date(aujourdhui.year, 12, 15) else aujourdhui.year + 1
    if date_creation is not None and date_creation.year == annee:
        return None  # exonération totale l'année de création — cette occurrence ne s'applique pas
    limite = _roule_si_weekend(date(annee, 12, 15))
    return Occurrence(str(annee), limite, None)


def des(aujourdhui: date, _periodicite: str | None = None) -> Occurrence:
    annee_periode, mois_periode = _mois_precedent(aujourdhui)
    return Occurrence(
        _libelle_periode_mois(annee_periode, mois_periode), None,
        "vers le 10 (jour ouvrable) du mois suivant la prestation",
    )


RESOLVEURS = {
    "urssaf": urssaf,
    "tva_acompte_juillet": tva_acompte_juillet,
    "tva_acompte_decembre": tva_acompte_decembre,
    "tva_ca12_annuelle": tva_ca12_annuelle,
    "tva_reel_normal": tva_reel_normal,
    "ir_annuelle": ir_annuelle,
    "des": des,
    # "cfe" a une signature différente (date de création plutôt que périodicité) — traité à part
    # dans moteur.py.
}


def statut_et_palier(date_limite: date | None, aujourdhui: date, regularisee: bool) -> tuple[str, str | None]:
    if regularisee:
        return "regularisee", None
    if date_limite is None:
        return "a_venir", None
    jours_restants = (date_limite - aujourdhui).days
    if jours_restants < 0:
        return "en_retard", "retard"
    if jours_restants == 0:
        return "urgent", "jour_j"
    if jours_restants <= 1:
        return "urgent", "J-1"
    if jours_restants <= 3:
        return "urgent", "J-3"
    if jours_restants <= 7:
        return "urgent", "J-7"
    if jours_restants <= 15:
        return "urgent", "J-15"
    if jours_restants <= 30:
        return "a_venir", "J-30"
    return "a_venir", None
