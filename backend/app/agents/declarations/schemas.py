"""Contrats de l'agent déclaratif.

Un brouillon n'est pas un tableau de chiffres : c'est la reproduction d'un formulaire officiel.
Chaque champ porte donc son libellé EXACT, sa valeur, et surtout sa PROVENANCE — de quelles
pièces il sort. Sans elle, l'utilisateur ne peut pas vérifier avant de transmettre, et il
transmet sous sa propre responsabilité.

`fiabilite` traduit une exigence explicite de la spécification : une référence de case non
recoupée avec le formulaire en vigueur ne doit jamais se présenter comme certaine.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

# Les cinq déclarations possibles.
TypeDeclaration = Literal["ca_urssaf", "des", "tva_ca3", "revenus_2042", "cfe"]

Frequence = Literal["mensuelle", "trimestrielle", "annuelle"]

# Confiance accordée à une référence de formulaire.
Fiabilite = Literal[
    "confirmee",     # case recoupée avec le formulaire officiel
    "a_verifier",    # structure connue, référence exacte NON recoupée
]

Priorite = Literal["haute", "normale", "info"]


class ChampBrouillon(BaseModel):
    """Un champ du formulaire officiel — valeur ET provenance, jamais l'une sans l'autre."""

    # Référence officielle quand elle existe (« 5KO »), sinon `None` pour un téléservice.
    case: Optional[str] = None
    libelle: str
    valeur: Optional[float | str | bool] = None
    unite: Optional[str] = "EUR"
    provenance: str = Field(
        description="D'où sort la valeur : quelles pièces, quelle période, quel calcul"
    )
    pieces_ids: List[str] = Field(default_factory=list)
    fiabilite: Fiabilite = "confirmee"
    note: Optional[str] = None


class Brouillon(BaseModel):
    """Brouillon d'une déclaration, calqué sur le formulaire ou le téléservice officiel."""

    type: TypeDeclaration
    titre: str
    formulaire: Optional[str] = None      # « 2042-C-PRO », « 3310-CA3 »… ou None (téléservice)
    cerfa: Optional[str] = None
    teleservice: Optional[str] = None
    lien: Optional[str] = None

    periode_debut: str
    periode_fin: str
    frequence: Frequence
    echeance: Optional[str] = None

    champs: List[ChampBrouillon] = Field(default_factory=list)
    # Montant à régler, quand la déclaration en emporte un. `None` = déclaration purement
    # informative (DES) ou montant non calculable ici (CFE, barème communal).
    montant_a_payer: Optional[float] = None

    applicable: bool = True
    motif_non_applicable: Optional[str] = None
    # Ce que l'utilisateur doit vérifier AVANT de recopier sur le site officiel.
    points_de_vigilance: List[str] = Field(default_factory=list)
    provenance: Dict[str, Any] = Field(default_factory=dict)


class Rappel(BaseModel):
    """Rappel d'échéance. Décrit un fait daté, jamais une action faite à la place de l'usager."""

    declaration: TypeDeclaration
    titre: str
    priorite: Priorite = "normale"
    echeance: Optional[str] = None
    message: str
    lien: Optional[str] = None


class ContexteDeclaratif(BaseModel):
    """Ce que l'utilisateur déclare et que la plateforme ne peut pas deviner.

    Préremplí depuis le profil d'onboarding, corrigeable à l'écran : la correction fait foi.
    """

    frequence: Frequence = "trimestrielle"
    categorie_par_defaut: Literal["BIC_VENTE", "BIC_SERVICE", "BNC"] = "BNC"
    caisse_bnc: Literal["REGIME_GENERAL", "CIPAV"] = "REGIME_GENERAL"
    acre_active: bool = False
    option_versement_liberatoire: bool = False
    assujetti_tva: bool = False
    numero_tva_intracom: Optional[str] = None
    date_creation: Optional[str] = None
    departement: Optional[str] = None
    # CA encaissé depuis le 1er janvier — sert au seuil de TVA et à l'exonération de CFP.
    ca_annuel_cumule: Optional[float] = None


class DemandeDeclarations(BaseModel):
    """Demande portant sur UNE échéance du calendrier.

    La période n'est pas libre : elle est imposée par la réglementation et par la périodicité
    déclarée à la création. L'écran envoie donc les bornes d'une échéance existante, pas des
    dates saisies à la main — sinon on produirait une déclaration sur une période qui n'en est
    pas une.
    """

    date_debut: str
    date_fin: str
    # Type d'échéance visé. `None` produit l'ensemble des déclarations de la période, ce qui
    # sert au dossier complet remis à l'expert-comptable.
    type_declaration: Optional[TypeDeclaration] = None
    contexte: ContexteDeclaratif = Field(default_factory=ContexteDeclaratif)
    enregistrer: bool = True


class RevenuUE(BaseModel):
    """Encaissement provenant d'une entité établie dans l'UE — déclencheur de la DES.

    S'applique MÊME sous franchise de TVA nationale : c'est le piège propre aux créateurs
    payés par une plateforme européenne.
    """

    virement_document_id: str
    date: Optional[str] = None
    montant_eur: float
    contrepartie: Optional[str] = None
    pays: Optional[str] = None
    plateforme: Optional[str] = None
    # Un indice de libellé n'est pas une preuve : la contrepartie réelle figure sur la pièce.
    certain: bool = False
    indice: Optional[str] = None


class JeuDeclarations(BaseModel):
    """Ensemble des brouillons et rappels produits pour une période."""

    id: str
    uid: str
    date_debut: str
    date_fin: str
    genere_le: str
    frequence: Frequence

    ca_encaisse: float
    ca_par_categorie: Dict[str, float] = Field(default_factory=dict)

    brouillons: List[Brouillon] = Field(default_factory=list)
    rappels: List[Rappel] = Field(default_factory=list)
    revenus_ue: List[RevenuUE] = Field(default_factory=list)

    # Résultat du moteur, recopié tel quel — jamais recalculé ici.
    prelevements: Dict[str, Any] = Field(default_factory=dict)

    # Pièces annexes exigées par le guide. Aucune n'entre dans une case : elles servent au
    # chiffrage de la TVA et au recoupement avant de déclarer.
    tva_collectee: Dict[str, Any] = Field(default_factory=dict)
    tva_deductible: Dict[str, Any] = Field(default_factory=dict)
    contrats_actifs: List[Dict[str, Any]] = Field(default_factory=list)
    # Avantages en nature reçus en contrepartie d'un service : du CHIFFRE D'AFFAIRES, sans
    # aucun flux bancaire. Ils entrent dans les cases, mais n'apparaissent sur aucun relevé.
    cadeaux_recus: List[Dict[str, Any]] = Field(default_factory=list)
    total_cadeaux_eur: float = 0.0
    # Cadeaux déclarés sans valeur retenue : non comptés, donc CA minoré. Jamais tus.
    cadeaux_a_valoriser: List[Dict[str, Any]] = Field(default_factory=list)
    # Rapport fiscal portant exactement la même période, s'il existe : un écart entre les
    # deux doit se voir AVANT de déclarer, pas se découvrir après.
    recoupement_rapport: Optional[Dict[str, Any]] = None

    avertissement: str
    hypotheses: List[str] = Field(default_factory=list)
    provenance: Dict[str, Any] = Field(default_factory=dict)
