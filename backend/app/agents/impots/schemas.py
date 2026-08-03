"""Contrats d'entrée/sortie du moteur de calcul d'impôt (micro-entreprise).

Ces modèles sont la surface exposée aux agents : ils décrivent ce qu'il faut
fournir et ce qui est rendu, y compris ce qui N'A PAS pu être calculé. Un
résultat partiel explicitement étiqueté vaut mieux qu'un chiffre plausible mais
faux — c'est la règle FR-08 du projet appliquée au calcul.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from .constantes import CaisseBNC, CategorieFiscale


class ActiviteCA(BaseModel):
    """Chiffre d'affaires encaissé HT sur une période, pour une catégorie."""

    categorie: CategorieFiscale
    ca: float = Field(ge=0, description="CA encaissé HT sur la période, en euros")


class ContexteFoyer(BaseModel):
    """Contexte fiscal du foyer, requis pour l'IR au barème.

    Sans `parts` ni `autres_revenus`, l'IR au barème n'est pas calculable : le
    moteur le dit au lieu de supposer un foyer type.
    """

    parts: Optional[float] = Field(default=None, gt=0, description="Nombre de parts fiscales")
    autres_revenus: Optional[float] = Field(
        default=None, ge=0, description="Revenu net imposable du foyer hors micro"
    )
    en_couple: bool = Field(default=False, description="Marié ou pacsé (imposition commune)")
    rfr_n2: Optional[float] = Field(
        default=None, ge=0, description="Revenu fiscal de référence de l'année N-2"
    )


class DemandeSimulation(BaseModel):
    activites: List[ActiviteCA] = Field(min_length=1)
    foyer: ContexteFoyer = Field(default_factory=ContexteFoyer)
    caisse_bnc: CaisseBNC = Field(default=CaisseBNC.regime_general)
    acre_active: bool = Field(default=False, description="ACRE en cours sur la période")
    option_versement_liberatoire: bool = Field(default=False)
    jours_activite: Optional[int] = Field(
        default=None, ge=1, le=366,
        description="Jours d'activité si première année partielle (prorata des plafonds)",
    )


class LigneAbattement(BaseModel):
    categorie: CategorieFiscale
    ca: float
    taux_abattement: float
    abattement: float
    base_imposable: float
    plancher_applique: bool = Field(
        description="Vrai si le plancher d'abattement a pris le pas sur le calcul proportionnel"
    )


class DetailIR(BaseModel):
    """Étapes du calcul de l'IR au barème, pour un revenu net imposable donné."""

    revenu_net_imposable: float
    parts: float
    impot_avant_plafonnement: float
    impot_apres_plafonnement: float
    plafonnement_applique: bool
    decote: float
    impot_net: float


class ResultatVersementLiberatoire(BaseModel):
    eligible: Optional[bool] = Field(
        default=None, description="None si l'éligibilité n'est pas déterminable (RFR N-2 absent)"
    )
    motif_ineligibilite: Optional[str] = None
    plafond_rfr: Optional[float] = None
    montant: Optional[float] = None


class DepassementPlafond(BaseModel):
    categorie: CategorieFiscale
    ca: float
    plafond: float
    plafond_proratise: bool


class ResultatSimulation(BaseModel):
    """Résultat complet. Tout champ à `None` signale un calcul non effectué."""

    # Étape 1
    ca_total: float
    lignes: List[LigneAbattement]
    base_imposable: float

    # Étapes 3 à 6 — IR au barème
    ir_bareme: Optional[float] = Field(
        default=None, description="IR imputable à l'activité micro (méthode différentielle)"
    )
    ir_bareme_calculable: bool
    detail_avec_micro: Optional[DetailIR] = None
    detail_sans_micro: Optional[DetailIR] = None

    # Étape 7
    versement_liberatoire: ResultatVersementLiberatoire

    # Étapes 8 et 9
    cotisations_sociales: float
    cfp: float
    acre_appliquee: bool

    # Étapes 10 et 11
    ir_retenu: Optional[float] = None
    option_retenue: Optional[str] = Field(
        default=None, description="'versement_liberatoire' | 'bareme'"
    )
    recommandation: Optional[str] = None
    total_prelevements: Optional[float] = None
    revenu_net_estime: Optional[float] = None
    taux_effectif: Optional[float] = None

    # Contrôles et transparence
    depassements: List[DepassementPlafond] = Field(default_factory=list)
    avertissements: List[str] = Field(default_factory=list)
    provenance: Dict[str, Any] = Field(default_factory=dict)
