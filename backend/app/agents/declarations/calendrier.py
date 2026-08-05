"""Calendrier déclaratif — les périodes sont IMPOSÉES par les règles, jamais choisies.

Une déclaration n'est pas un document qu'on demande quand on veut : elle porte sur une période
fixée par la réglementation et par la périodicité déclarée à la création de l'entreprise. Cet
agent énumère donc ces périodes, et c'est à chacune d'elles qu'un document est produit.

Les conventions de date reprennent celles déjà en place dans `app.agents.echeancier.dates`,
elles-mêmes sourcées dans `data/regimes/micro.yaml`. Rien n'est redéfini ici.

Quand la source officielle donne une FENÊTRE plutôt qu'un jour — « mai-juin selon votre
département », « 10ᵉ jour ouvrable » — on garde la fenêtre. Fabriquer une date précise à partir
d'une fenêtre serait inventer une échéance.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date
from typing import Iterable, List, Optional

from .schemas import Frequence, TypeDeclaration

_MOIS_FR = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]

# Échéances trimestrielles de l'URSSAF : chaque date limite porte sur le trimestre PRÉCÉDENT.
_LIMITES_TRIMESTRE = {1: (4, 30), 2: (7, 31), 3: (10, 31), 4: (1, 31)}


def _fin_de_mois(annee: int, mois: int) -> date:
    return date(annee, mois, calendar.monthrange(annee, mois)[1])


def _roule_si_weekend(d: date) -> date:
    """Reporte au jour ouvré suivant. Les jours fériés ne sont PAS connus : c'est une
    approximation assumée, signalée comme telle sur les échéances concernées."""
    while d.weekday() >= 5:
        d = date.fromordinal(d.toordinal() + 1)
    return d


@dataclass
class Echeance:
    """Une déclaration à produire, pour une période imposée."""

    type: TypeDeclaration
    libelle: str
    periode_debut: date
    periode_fin: date
    libelle_periode: str
    frequence: Frequence
    # `date_limite` OU `fenetre_indicative` — jamais les deux, jamais aucun des deux.
    date_limite: Optional[date] = None
    fenetre_indicative: Optional[str] = None
    obligatoire_meme_a_zero: bool = False
    note: Optional[str] = None
    conditions: List[str] = field(default_factory=list)

    def statut(self, aujourdhui: date) -> str:
        """`a_venir` tant que la période court, `a_faire` ensuite, `en_retard` après la limite."""
        if aujourdhui <= self.periode_fin:
            return "periode_en_cours"
        if self.date_limite and aujourdhui > self.date_limite:
            return "en_retard"
        return "a_faire"

    def to_dict(self, aujourdhui: date) -> dict:
        return {
            "type": self.type,
            "libelle": self.libelle,
            "periode_debut": self.periode_debut.isoformat(),
            "periode_fin": self.periode_fin.isoformat(),
            "libelle_periode": self.libelle_periode,
            "frequence": self.frequence,
            "date_limite": self.date_limite.isoformat() if self.date_limite else None,
            "fenetre_indicative": self.fenetre_indicative,
            "obligatoire_meme_a_zero": self.obligatoire_meme_a_zero,
            "note": self.note,
            "conditions": self.conditions,
            "statut": self.statut(aujourdhui),
        }


# ------------------------------------------------------------------ URSSAF
def echeances_urssaf(annee: int, frequence: Frequence) -> List[Echeance]:
    """Déclaration de CA — mensuelle ou trimestrielle selon le choix fait à la création.

    Obligatoire même à 0 € : l'absence de paiement n'est pas une faute quand le CA est nul,
    l'absence de déclaration en est une.
    """
    if frequence == "trimestrielle":
        echeances = []
        for trimestre in range(1, 5):
            debut = date(annee, (trimestre - 1) * 3 + 1, 1)
            fin = _fin_de_mois(annee, trimestre * 3)
            mois_limite, jour_limite = _LIMITES_TRIMESTRE[trimestre]
            # Le T4 se déclare en janvier de l'année suivante.
            annee_limite = annee + 1 if trimestre == 4 else annee
            echeances.append(Echeance(
                type="ca_urssaf",
                libelle="Déclaration de chiffre d'affaires (URSSAF)",
                periode_debut=debut, periode_fin=fin,
                libelle_periode=f"T{trimestre} {annee}",
                frequence="trimestrielle",
                date_limite=date(annee_limite, mois_limite, jour_limite),
                obligatoire_meme_a_zero=True,
            ))
        return echeances

    echeances = []
    for mois in range(1, 13):
        debut = date(annee, mois, 1)
        fin = _fin_de_mois(annee, mois)
        # Mensuelle : le mois se déclare avant la fin du mois SUIVANT.
        suivant = (annee + 1, 1) if mois == 12 else (annee, mois + 1)
        echeances.append(Echeance(
            type="ca_urssaf",
            libelle="Déclaration de chiffre d'affaires (URSSAF)",
            periode_debut=debut, periode_fin=fin,
            libelle_periode=f"{_MOIS_FR[mois - 1]} {annee}",
            frequence="mensuelle",
            date_limite=_fin_de_mois(*suivant),
            obligatoire_meme_a_zero=True,
        ))
    return echeances


# --------------------------------------------------------------------- DES
def echeances_des(annee: int, mois_avec_revenu_ue: Iterable[int]) -> List[Echeance]:
    """DES — mensuelle, mais UNIQUEMENT les mois où un revenu européen a été encaissé.

    Contrairement à la déclaration de CA, il n'y a pas de DES « à zéro » : sans prestation
    intracommunautaire sur le mois, il n'y a rien à déclarer.
    """
    return [
        Echeance(
            type="des",
            libelle="Déclaration européenne de services (DES)",
            periode_debut=date(annee, mois, 1),
            periode_fin=_fin_de_mois(annee, mois),
            libelle_periode=f"{_MOIS_FR[mois - 1]} {annee}",
            frequence="mensuelle",
            # « 10ᵉ jour ouvrable » suppose le calendrier des jours fériés : on garde la
            # fenêtre plutôt que de fabriquer une date fausse.
            fenetre_indicative=(
                f"10ᵉ jour ouvrable de {_MOIS_FR[mois % 12]} "
                f"{annee + 1 if mois == 12 else annee}"
            ),
            note=(
                "Déclaration informative : aucun paiement. L'oubli reste toutefois traité "
                "comme une infraction fiscale."
            ),
            conditions=["Un encaissement provenant de l'Union européenne a été détecté."],
        )
        for mois in sorted(set(mois_avec_revenu_ue))
    ]


# --------------------------------------------------------------------- TVA
def echeances_tva(annee: int, regime_tva: Optional[str], frequence: Frequence) -> List[Echeance]:
    """CA3 — seulement une fois redevable. Sous franchise, aucune échéance."""
    regime = (regime_tva or "").strip().lower()
    if regime not in ("reel_simplifie", "reel_normal"):
        return []

    if regime == "reel_simplifie":
        # Régime simplifié : deux acomptes et une régularisation annuelle (CA12).
        return [
            Echeance(
                type="tva_ca3", libelle="Acompte de TVA de juillet (CA12)",
                periode_debut=date(annee, 1, 1), periode_fin=date(annee, 6, 30),
                libelle_periode=f"1er semestre {annee}", frequence="annuelle",
                fenetre_indicative=f"entre le 15 et le 24 juillet {annee}",
                note="Acompte de 55 % de la TVA de référence.",
            ),
            Echeance(
                type="tva_ca3", libelle="Acompte de TVA de décembre (CA12)",
                periode_debut=date(annee, 7, 1), periode_fin=date(annee, 12, 31),
                libelle_periode=f"2ᵉ semestre {annee}", frequence="annuelle",
                fenetre_indicative=f"entre le 15 et le 24 décembre {annee}",
                note="Acompte de 40 % de la TVA de référence.",
            ),
            Echeance(
                type="tva_ca3", libelle="Régularisation annuelle de TVA (CA12)",
                periode_debut=date(annee, 1, 1), periode_fin=date(annee, 12, 31),
                libelle_periode=str(annee), frequence="annuelle",
                fenetre_indicative=f"début mai {annee + 1} (2ᵉ jour ouvré après le 1er mai)",
            ),
        ]

    # Réel normal : mensuelle. La date exacte dépend du SIREN, l'administration la notifie.
    return [
        Echeance(
            type="tva_ca3", libelle="Déclaration de TVA (CA3)",
            periode_debut=date(annee, mois, 1), periode_fin=_fin_de_mois(annee, mois),
            libelle_periode=f"{_MOIS_FR[mois - 1]} {annee}", frequence="mensuelle",
            fenetre_indicative=(
                "échéance mensuelle variable selon votre SIREN — voir votre calendrier "
                "fiscal personnel sur impots.gouv.fr"
            ),
        )
        for mois in range(1, 13)
    ]


# ------------------------------------------------------- Revenus annuels
def echeances_revenus(annee_revenus: int, departement: Optional[str]) -> List[Echeance]:
    """2042-C-PRO — une fois par an, sur les revenus de l'année écoulée.

    La date limite dépend du département ET change chaque année : elle n'est jamais codée en
    dur, seulement rappelée comme fenêtre.
    """
    precision = (
        f" (département {departement} — vérifiez la date exacte publiée chaque année)"
        if departement else " — la date exacte dépend de votre département"
    )
    return [Echeance(
        type="revenus_2042",
        libelle="Déclaration annuelle des revenus (2042-C-PRO)",
        periode_debut=date(annee_revenus, 1, 1),
        periode_fin=date(annee_revenus, 12, 31),
        libelle_periode=f"revenus {annee_revenus}",
        frequence="annuelle",
        fenetre_indicative=f"mai-juin {annee_revenus + 1}{precision}",
        obligatoire_meme_a_zero=True,
        note=(
            "Obligatoire pour tous, y compris sous versement libératoire — le chiffre "
            "d'affaires y est alors reporté à titre informatif."
        ),
    )]


# --------------------------------------------------------------------- CFE
def echeances_cfe(annee: int, date_creation: Optional[date]) -> List[Echeance]:
    """CFE — annuelle, en décembre. Exonération totale l'année de création."""
    if date_creation is not None and date_creation.year >= annee:
        return []
    return [Echeance(
        type="cfe",
        libelle="Cotisation foncière des entreprises (CFE)",
        periode_debut=date(annee, 1, 1), periode_fin=date(annee, 12, 31),
        libelle_periode=str(annee), frequence="annuelle",
        date_limite=_roule_si_weekend(date(annee, 12, 15)),
        note=(
            "Montant calculé et notifié par l'administration : il dépend d'un barème communal. "
            "Aucune déclaration périodique — seulement un règlement."
        ),
    )]


# --------------------------------------------------------------- Assemblage
def calendrier(
    annee: int,
    *,
    frequence: Frequence = "trimestrielle",
    regime_tva: Optional[str] = None,
    date_creation: Optional[date] = None,
    mois_avec_revenu_ue: Iterable[int] = (),
) -> List[Echeance]:
    """Toutes les échéances déclaratives de l'année, dans l'ordre chronologique.

    `frequence` vient du profil (choix fait à la création), pas d'un réglage d'écran : la
    périodicité de déclaration n'est pas une préférence d'affichage.
    """
    toutes = (
        echeances_urssaf(annee, frequence)
        + echeances_des(annee, mois_avec_revenu_ue)
        + echeances_tva(annee, regime_tva, frequence)
        + echeances_revenus(annee - 1, None)
        + echeances_cfe(annee, date_creation)
    )
    return sorted(toutes, key=lambda e: (e.periode_fin, e.type))


def prochaine(echeances: Iterable[Echeance], aujourdhui: date) -> Optional[Echeance]:
    """Prochaine déclaration à produire : la plus ancienne encore due."""
    dues = [e for e in echeances if e.statut(aujourdhui) in ("a_faire", "en_retard")]
    return min(dues, key=lambda e: e.periode_fin) if dues else None
