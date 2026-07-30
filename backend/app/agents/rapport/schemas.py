"""Schémas du rapport d'activité par période.

Les chiffres clés sont calculés en code à partir des factures émises de la période (voir
`consolidation.py`) ; le moteur déterministe existant (`guidance.roadmap`) fournit la position
vis-à-vis des seuils et l'estimation des cotisations — rien n'est dupliqué ni ré-estimé par un
LLM. Seule l'appréciation qualitative (`appreciation`) vient du LLM, contrainte à ces chiffres.
"""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field


class PeriodeRequest(BaseModel):
    date_debut: date
    date_fin: date


class ChiffreCle(BaseModel):
    """Un chiffre affiché, avec sa provenance — jamais un nombre nu sans traçabilité."""

    cle: str
    libelle: str
    valeur: str
    source: str | None = None  # None = calculé depuis les factures de la période, pas une norme


class SignalConformite(BaseModel):
    """Un ÉCART À VÉRIFIER, jamais une accusation. Formulation prudente imposée en code, pas
    laissée au LLM (mêmes règles que l'agent d'insights : signal, jamais un verdict)."""

    label: str
    question: str


class RapportActivite(BaseModel):
    id: str
    uid: str
    date_debut: date
    date_fin: date

    nb_factures: int
    total_ht: float
    total_ttc: float
    ventilation_prestations_ht: float
    ventilation_ventes_ht: float
    avantages_nature: float | None = None  # repris du profil partagé, si renseigné

    categorie_fiscale: str  # "bnc" | "bic" | "mixte" (moteur déterministe)
    seuil_applicable: float
    position_vs_seuil_pct: float  # (total_ht / seuil) * 100, arrondi
    regime_recommande: str
    cotisations_estimees: float
    cotisations_taux: float
    cotisations_source: str

    chiffres_cles: list[ChiffreCle]
    signaux_conformite: list[SignalConformite]

    resume_narratif: str
    appreciation: str
    objectif_utilisateur: str | None = None

    sources: list[str]
    created_at: str
