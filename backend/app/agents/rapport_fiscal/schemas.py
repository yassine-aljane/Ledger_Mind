"""Contrats du rapport fiscal — rapprochement bancaire et synthèse d'imposition.

Règle métier non négociable : le chiffre d'affaires imposable est le **CA ENCAISSÉ**, pas le
CA facturé. Une facture émise et non payée ne compte pas pour la période ; elle comptera pour
celle où le virement arrive. Tous les schémas ci-dessous découlent de cette règle.

**Un seul rapport**, pas deux. Le CA facturé n'est pas un rapport concurrent : c'est un
indicateur DANS le rapport, à côté de l'encaissé, pour montrer l'écart entre ce qui a été
facturé et ce qui est réellement rentré. L'assiette, elle, reste l'encaissé.

Sources réunies : factures émises par la plateforme, virements et contrats capturés, factures
de dépense capturées, et le profil déclaré à l'onboarding.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

# Comment un encaissement a été rattaché à une facture.
MethodeRapprochement = Literal[
    "numero_facture",   # le n° figure dans le motif ou la référence : certain
    "montant_date",     # montant et fenêtre de dates concordants : à confirmer
    "manuel",           # rattachement décidé par l'utilisateur
]


class LigneEncaissement(BaseModel):
    """Un encaissement retenu dans le CA, traçable jusqu'à son virement.

    C'est l'unité d'audit : chaque euro du CA déclaré doit pouvoir être remonté ici.
    """

    virement_document_id: str
    montant: float = Field(
        description="Montant réellement reçu, TVA comprise — celui qui figure sur le relevé"
    )
    montant_ht: float = Field(
        description=(
            "Part hors taxe de l'encaissement : c'est ELLE qui constitue le chiffre d'affaires. "
            "La TVA collectée n'est pas un revenu, elle transite. En franchise en base les deux "
            "montants coïncident."
        )
    )
    date_valeur: Optional[str] = None
    libelle: Optional[str] = None
    contrepartie: Optional[str] = None
    facture_numero: Optional[str] = None
    facture_id: Optional[str] = None
    methode: MethodeRapprochement
    certain: bool = Field(
        description="Faux si le rattachement demande une confirmation humaine"
    )
    categorie: Literal["prestation", "vente"] = "prestation"


class VirementNonRetenu(BaseModel):
    """Virement écarté du CA, avec le motif — jamais d'exclusion silencieuse."""

    virement_document_id: str
    montant: float
    date_valeur: Optional[str] = None
    libelle: Optional[str] = None
    contrepartie: Optional[str] = None
    motif: str
    action_suggeree: Optional[str] = None


class FactureNonSoldee(BaseModel):
    """Facture émise dont l'encaissement manque ou reste partiel."""

    numero: Optional[str] = None
    facture_id: str
    client: Optional[str] = None
    date_emission: Optional[str] = None
    date_echeance: Optional[str] = None
    net_a_payer: float
    encaisse: float
    reste_du: float
    en_retard: bool = False
    jours_de_retard: Optional[int] = None


class EcartRapprochement(BaseModel):
    """Incohérence constatée, à trancher par l'utilisateur."""

    type: str
    message: str
    facture_numero: Optional[str] = None
    virement_document_id: Optional[str] = None
    ecart: Optional[float] = None


class Rapprochement(BaseModel):
    """Résultat complet du rapprochement facture ↔ virement, entièrement auditable."""

    periode_debut: str
    periode_fin: str
    ca_encaisse: float
    ca_encaisse_certain: float = Field(
        description="Part du CA dont le rattachement ne demande aucune confirmation"
    )
    encaissements: List[LigneEncaissement] = Field(default_factory=list)
    virements_non_retenus: List[VirementNonRetenu] = Field(default_factory=list)
    factures_impayees: List[FactureNonSoldee] = Field(default_factory=list)
    factures_partielles: List[FactureNonSoldee] = Field(default_factory=list)
    ecarts: List[EcartRapprochement] = Field(default_factory=list)
    ca_par_categorie: Dict[str, float] = Field(default_factory=dict)
    # Virements écartés pour la SEULE raison qu'ils tombent hors de la période. Ils ne sont
    # pas comptés, mais les taire laissait l'utilisateur devant un « CA : 0 € » inexplicable
    # alors que son virement se trouvait à un jour de la borne.
    virements_hors_periode: List[Dict[str, Any]] = Field(default_factory=list)


class ContexteFiscalRapport(BaseModel):
    """Ce que l'utilisateur déclare, et que la plateforme ne peut pas deviner.

    Sans `parts_fiscales` ni `autres_revenus`, le moteur ne calcule PAS l'IR au barème —
    il le dit, et le rapport le répercute plutôt que d'afficher un chiffre inventé.
    """

    parts_fiscales: Optional[float] = Field(default=None, gt=0)
    autres_revenus: Optional[float] = Field(default=None, ge=0)
    en_couple: bool = False
    rfr_n2: Optional[float] = Field(default=None, ge=0)
    caisse_bnc: Literal["REGIME_GENERAL", "CIPAV"] = "REGIME_GENERAL"
    acre_active: bool = False
    option_versement_liberatoire: bool = False
    jours_activite: Optional[int] = Field(default=None, ge=1, le=366)
    dom: bool = Field(
        default=False,
        description=(
            "Activité exercée dans un DOM. Les taux minorés outre-mer et la réfaction d'impôt "
            "ne figurent PAS dans la table de référence : le rapport le signale au lieu "
            "d'appliquer des taux métropolitains à un cas qui n'en relève pas."
        ),
    )
    # Catégorie fiscale par défaut quand la ligne de facture ne permet pas de trancher.
    categorie_par_defaut: Literal["BIC_VENTE", "BIC_SERVICE", "BNC"] = "BNC"


class ContratEnCours(BaseModel):
    """Contrat capturé dont la période recouvre celle du rapport.

    Un contrat n'entre JAMAIS dans le chiffre d'affaires : il engage, il n'encaisse pas. Il
    éclaire en revanche deux choses — du revenu engagé qui n'a pas encore été facturé, et la
    présence d'un contrat de travail, qui relève du salariat et non de la micro-entreprise.
    """

    document_id: str
    type: Optional[str] = None
    titre: Optional[str] = None
    contrepartie: Optional[str] = None
    date_debut: Optional[str] = None
    date_fin: Optional[str] = None
    montant_eur: Optional[float] = None
    echeancier: Optional[str] = None
    duree_indeterminee: Optional[bool] = None


class DepenseCapturee(BaseModel):
    """Facture de dépense capturée. Informative UNIQUEMENT.

    En micro-entreprise, l'abattement forfaitaire remplace la déduction des frais réels :
    ces montants ne réduisent ni la base imposable, ni l'assiette sociale. Les afficher sert
    à mesurer la marge réelle, pas à alléger l'impôt.
    """

    document_id: str
    fournisseur: Optional[str] = None
    numero: Optional[str] = None
    date: Optional[str] = None
    montant_eur: Optional[float] = None
    categorie: Optional[str] = None


class SourcesRapport(BaseModel):
    """Ce sur quoi le rapport s'appuie, et en quelle quantité — traçabilité de l'assiette."""

    factures_emises: int = 0
    virements_analyses: int = 0
    contrats_en_cours: int = 0
    depenses_capturees: int = 0
    profil_onboarding: bool = False
    contrats: List[ContratEnCours] = Field(default_factory=list)
    depenses: List[DepenseCapturee] = Field(default_factory=list)
    total_depenses_eur: float = 0.0
    revenu_contractuel_engage_eur: float = 0.0


class DemandeRapport(BaseModel):
    date_debut: str
    date_fin: str
    contexte: ContexteFiscalRapport = Field(default_factory=ContexteFiscalRapport)
    # Un rapport enregistré reste consultable ; le désactiver sert aux aperçus jetables.
    enregistrer: bool = True


class Alerte(BaseModel):
    niveau: Literal["info", "vigilance", "critique"]
    titre: str
    message: str
    source: Optional[str] = None


class RapportFiscal(BaseModel):
    """Rapport complet. Tout champ nul signale un calcul non effectué, jamais approximé."""

    id: str
    uid: str
    date_debut: str
    date_fin: str
    genere_le: str

    # Assiette retenue — l'ENCAISSÉ, toujours.
    ca_retenu: float
    base_de_calcul: str = Field(
        description="Phrase expliquant CE QUI a été compté, et pourquoi"
    )
    # Indicateur, pas assiette : montre l'écart entre ce qui a été facturé sur la période et
    # ce qui est réellement rentré. Ne sert à aucun calcul d'impôt.
    ca_facture_periode: float = 0.0
    rapprochement: Optional[Rapprochement] = None
    sources: SourcesRapport = Field(default_factory=SourcesRapport)

    # Résultat du moteur d'impôt — recopié tel quel, jamais recalculé ici
    simulation: Optional[Dict[str, Any]] = None
    ir_calculable: bool = True

    # Franchise en base de TVA : position par rapport aux seuils, SANS aucun calcul de TVA
    tva: Dict[str, Any] = Field(default_factory=dict)

    # Catégorie(s) fiscale(s) réellement appliquées. Elles commandent l'abattement, le taux
    # de cotisations, la CFP, le versement libératoire et le plafond : les taire rendrait le
    # reste du rapport invérifiable.
    categories_fiscales: List[str] = Field(default_factory=list)

    # Contrôle du plafond micro, par catégorie — conforme ou non, l'état est toujours donné.
    plafonds: Dict[str, Any] = Field(default_factory=dict)

    # Constantes effectivement appliquées, avec leur provenance : le calcul doit être
    # vérifiable ligne à ligne, pas seulement plausible.
    parametres: List[Dict[str, Any]] = Field(default_factory=list)

    # Statut de l'ACRE : active ou non, réduction, trimestres restants.
    acre: Dict[str, Any] = Field(default_factory=dict)

    # Prorata de première année : jours d'activité et plafond réduit à due proportion.
    prorata: Dict[str, Any] = Field(default_factory=dict)

    alertes: List[Alerte] = Field(default_factory=list)
    hypotheses: List[str] = Field(default_factory=list)
    provenance: Dict[str, Any] = Field(default_factory=dict)
