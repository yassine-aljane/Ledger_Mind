"""Schémas de la déclaration fiscale préparée — 2042-C-PRO (micro-BNC / micro-BIC).

Un document PRÉPARÉ pour relecture puis signature par un expert-comptable, jamais transmis
automatiquement à l'administration (chantier 3.3). Chaque case porte sa provenance exacte
(quelles factures, quel calcul) pour que la revue avant transmission (3.2) soit réellement
vérifiable, pas une simple confiance aveugle dans un total.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

StatutDeclaration = Literal["brouillon", "revue", "prete_signature"]


class LigneDeclaration(BaseModel):
    """Une case du formulaire — montant ET provenance, jamais l'un sans l'autre."""

    case: str  # ex. "5HQ", "5KO", "5KP"
    libelle: str
    montant: float
    provenance: str  # ex. "3 factures (FA-2026-000001, ...002, ...004)"
    factures_ids: list[str]


class Declaration(BaseModel):
    id: str
    uid: str
    date_debut: date
    date_fin: date

    formulaire: str = "2042-C-PRO"
    regime: str  # libellé humain (ex. "Micro-BNC (prestations de services)")
    categorie: str  # bnc | bic_services | bic_vente | mixte
    source_formulaire: str  # URL officielle d'où les cases ont été vérifiées

    lignes: list[LigneDeclaration]
    total_ca_declare: float

    cotisations_urssac_estimees: float
    cotisations_urssac_taux: float
    cotisations_urssac_source: str

    statut: StatutDeclaration = "brouillon"
    revue_le: str | None = None  # horodatage ISO de la revue utilisateur (3.2)

    rapport_source_id: str | None = None  # rapport d'activité dont elle est dérivée

    avertissement: str
    created_at: str
