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
    # Avantages en nature entrant dans cette case. Une case peut réunir du facturé et du
    # reçu en nature : les deux sont des recettes, mais leur trace n'est pas la même —
    # un cadeau n'a ni numéro de facture ni virement à produire en cas de contrôle.
    cadeaux_ids: list[str] = Field(default_factory=list)
    montant_facture: float = 0.0
    montant_nature: float = 0.0


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
    # Part du total venant d'avantages en nature. Isolée parce qu'elle ne se justifie pas
    # de la même façon : ni facture, ni virement — la valeur marchande retenue engage
    # l'utilisateur, qui l'a confirmée pièce par pièce.
    total_recettes_nature: float = 0.0
    # Avantages connus mais non repris (date manquante, devise non convertie), avec leur
    # motif. Un brouillon incomplet doit dire ce qu'il ne contient pas.
    cadeaux_ecartes: list[str] = Field(default_factory=list)

    cotisations_urssac_estimees: float
    cotisations_urssac_taux: float
    cotisations_urssac_source: str

    statut: StatutDeclaration = "brouillon"
    revue_le: str | None = None  # horodatage ISO de la revue utilisateur (3.2)

    rapport_source_id: str | None = None  # rapport d'activité dont elle est dérivée

    avertissement: str
    created_at: str
