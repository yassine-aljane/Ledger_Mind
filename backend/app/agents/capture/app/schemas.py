"""Schémas Pydantic v2 : modèle métier Invoice, état du graphe LangGraph,
et contrats d'entrée/sortie de l'API FastAPI.

Règle transverse (FR-08) : tout champ manquant ou illisible vaut `None`.
Rien n'est inventé.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from typing_extensions import TypedDict

from .config import EXPENSE_CATEGORIES


# --- Modèle métier -----------------------------------------------------------
class LineItem(BaseModel):
    """Une ligne de facture. Tous les champs sont optionnels (peuvent être null)."""

    description: Optional[str] = None
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    total: Optional[float] = None


class Invoice(BaseModel):
    """Facture extraite. Les champs absents/illisibles restent `None` (FR-08)."""

    invoice_number: Optional[str] = None
    issuer_name: Optional[str] = None
    issuer_tax_id: Optional[str] = None          # matricule fiscal de l'émetteur
    client_name: Optional[str] = None
    issue_date: Optional[str] = None             # ISO 'YYYY-MM-DD' si possible
    line_items: List[LineItem] = Field(default_factory=list)
    subtotal_ht: Optional[float] = None
    vat_amount: Optional[float] = None
    total_ttc: Optional[float] = None
    currency: Optional[str] = None
    # Unification devise (FR : montant TTC converti en EUR au taux de la date d'émission).
    amount_eur: Optional[float] = None
    exchange_rate: Optional[float] = None        # taux `currency` -> EUR appliqué
    rate_date: Optional[str] = None              # date du taux utilisé (ISO 'YYYY-MM-DD')
    rate_source: Optional[str] = None            # provenance du taux ('BCE' | 'Currency-API')
    # Suivi de paiement (FR-18 : factures à régler).
    paid: Optional[bool] = None                  # True si la facture est indiquée réglée
    due_date: Optional[str] = None               # échéance explicite (ISO 'YYYY-MM-DD') si présente
    payment_terms_days: Optional[int] = None     # délai de paiement en jours (ex. « à 30 jours » -> 30)

    def dedup_key(self) -> Dict[str, Any]:
        """Clé d'unicité (FR-12) : numéro + matricule + total TTC + date."""
        return {
            "invoice_number": self.invoice_number,
            "issuer_tax_id": self.issuer_tax_id,
            "total_ttc": self.total_ttc,
            "issue_date": self.issue_date,
        }


class ExpenseCategory(str, Enum):
    materiel = "matériel"
    services = "services"
    restauration = "restauration"
    transport = "transport"
    communication = "communication"
    autre = "autre"


class DocumentType(str, Enum):
    """Nature du document déposé (détectée automatiquement)."""

    facture = "facture"
    virement = "virement"
    contrat = "contrat"
    autre = "autre"          # aucun des trois : le document n'est pas traité


class ContractType(str, Enum):
    """Nature juridique du contrat déposé."""

    travail = "travail"
    prestation = "prestation"
    partenariat = "partenariat"
    sponsoring = "sponsoring"
    bail = "bail"
    confidentialite = "confidentialité"
    autre = "autre"


class ContractParty(BaseModel):
    """Une partie signataire. Champs absents/illisibles = None (FR-08)."""

    name: Optional[str] = None
    role: Optional[str] = None          # employeur, salarié, sponsor, prestataire…
    identifier: Optional[str] = None    # SIREN/SIRET ou n° d'identification


class Contract(BaseModel):
    """Contrat extrait (travail, partenariat, sponsoring…). Champs absents = None.

    Un contrat n'a ni montant TTC ni ligne de facturation : ce qui compte est
    QUI s'engage, SUR QUOI, PENDANT COMBIEN DE TEMPS et POUR QUELLE
    contrepartie. Le modèle suit cette logique plutôt que celle d'une pièce
    comptable.
    """

    contract_type: Optional[str] = None       # valeur de ContractType
    title: Optional[str] = None               # intitulé du contrat
    reference: Optional[str] = None           # n° de contrat / référence
    parties: List[ContractParty] = Field(default_factory=list)
    signature_date: Optional[str] = None      # ISO 'YYYY-MM-DD'
    start_date: Optional[str] = None          # prise d'effet (ISO)
    end_date: Optional[str] = None            # échéance (ISO) ; None si indéterminée
    duration_months: Optional[int] = None
    is_open_ended: Optional[bool] = None      # durée indéterminée (CDI, tacite…)
    # Contrepartie financière : rémunération, forfait, budget de sponsoring…
    amount: Optional[float] = None
    currency: Optional[str] = None
    amount_eur: Optional[float] = None
    exchange_rate: Optional[float] = None
    rate_date: Optional[str] = None
    rate_source: Optional[str] = None
    payment_schedule: Optional[str] = None    # mensuel, forfait, à la livraison…
    notice_period_days: Optional[int] = None  # préavis de résiliation, en jours
    renewal: Optional[str] = None             # tacite reconduction, non renouvelable…
    jurisdiction: Optional[str] = None        # droit applicable / juridiction
    obligations: List[str] = Field(default_factory=list)  # engagements clés relevés

    def dedup_key(self) -> Dict[str, Any]:
        """Clé d'unicité : référence + type + date de signature + montant."""
        return {
            "reference": self.reference,
            "contract_type": self.contract_type,
            "signature_date": self.signature_date,
            "amount": self.amount,
        }


class Cadeau(BaseModel):
    """Cadeau / avantage en nature reçu d'une marque (« gifting »).

    Ce n'est fiscalement PAS un cadeau : un partenariat rémunéré en produits ou en
    services est un revenu en nature. Il se déclare à sa valeur marchande — le prix
    public TTC de l'objet à l'état neuf — et entre au livre des recettes comme un
    encaissement en numéraire.

    D'où la séparation, tenue dans tout ce modèle, entre :
      - `valeur_ttc` : la valeur RETENUE, celle qui sera déclarée. Elle engage
        l'utilisateur, qui l'a saisie ou confirmée.
      - `valeur_estimee` et sa fourchette : une SUGGESTION issue d'une photo. Une
        image ne donne jamais un prix certain (contrefaçon, série, état, taille…),
        et la présenter comme un montant sûr ferait porter à l'utilisateur une
        erreur de déclaration qui n'est pas la sienne.
    Les deux sont persistées côte à côte : on doit pouvoir dire a posteriori si un
    montant déclaré venait de la machine ou de l'humain.
    """

    description: Optional[str] = None        # nature de l'objet reçu
    marque: Optional[str] = None             # marque / client à l'origine du cadeau
    date_reception: Optional[str] = None     # ISO 'YYYY-MM-DD'

    # --- Valeur retenue (déclarée) ---
    valeur_ttc: Optional[float] = None
    devise: Optional[str] = None
    valeur_eur: Optional[float] = None
    exchange_rate: Optional[float] = None
    rate_date: Optional[str] = None
    rate_source: Optional[str] = None

    # --- Suggestion automatique depuis la photo ---
    objet_identifie: Optional[str] = None
    valeur_estimee: Optional[float] = None
    fourchette_min: Optional[float] = None
    fourchette_max: Optional[float] = None
    confiance: Optional[str] = None          # 'haute' | 'moyenne' | 'faible'
    source_estimation: Optional[str] = None  # ex. 'vision-mistral'
    # True dès que la valeur retenue diffère de l'estimation : trace de l'arbitrage.
    valeur_corrigee: Optional[bool] = None

    contrepartie: Optional[str] = None       # ce qui est attendu en échange (post, story…)

    def dedup_key(self) -> Dict[str, Any]:
        """Clé d'unicité : même marque, même objet, même jour, même valeur.

        Deux cadeaux distincts d'une même marque le même jour restent possibles —
        d'où l'inclusion de la description ET de la valeur, plutôt qu'une clé
        marque+date qui les confondrait.
        """
        return {
            "marque": self.marque,
            "description": self.description,
            "date_reception": self.date_reception,
            "valeur_ttc": self.valeur_ttc,
        }


class BankTransfer(BaseModel):
    """Virement bancaire (cadre France). Champs absents/illisibles = None (FR-08).

    IBAN français = FR + 25 caractères (stockés sans espaces).
    """

    transfer_reference: Optional[str] = None     # référence / n° d'opération
    execution_date: Optional[str] = None         # date d'exécution (ISO 'YYYY-MM-DD')
    value_date: Optional[str] = None             # date de valeur (ISO) si présente
    amount: Optional[float] = None
    currency: Optional[str] = None               # ex. EUR
    # Unification devise (FR : montant converti en EUR au taux de la date d'exécution).
    amount_eur: Optional[float] = None
    exchange_rate: Optional[float] = None        # taux `currency` -> EUR appliqué
    rate_date: Optional[str] = None              # date du taux utilisé (ISO 'YYYY-MM-DD')
    rate_source: Optional[str] = None            # provenance du taux ('BCE' | 'Currency-API')
    direction: Optional[str] = None              # 'emis' | 'recu' (sens du virement)
    sender_name: Optional[str] = None            # donneur d'ordre / émetteur
    sender_iban: Optional[str] = None
    beneficiary_name: Optional[str] = None       # bénéficiaire
    beneficiary_iban: Optional[str] = None
    beneficiary_bic: Optional[str] = None        # BIC / SWIFT
    bank_name: Optional[str] = None
    motif: Optional[str] = None                  # motif / libellé / communication
    transfer_type: Optional[str] = None          # SEPA / instantané / international

    def dedup_key(self) -> Dict[str, Any]:
        return {
            "transfer_reference": self.transfer_reference,
            "amount": self.amount,
            "execution_date": self.execution_date,
        }


# --- Statuts exposés à l'API -------------------------------------------------
class Status(str, Enum):
    completed = "completed"
    en_attente_utilisateur = "en_attente_utilisateur"
    erreur = "erreur"
    # Le document a été lu sans encombre, mais il ne relève d'aucun des trois
    # types traités. Ce n'est pas une erreur : rien n'a échoué, il n'y a
    # simplement rien à extraire — et donc rien à enregistrer.
    non_pris_en_charge = "non_pris_en_charge"


class PendingType(str, Enum):
    champ_manquant = "champ_manquant"
    # Champ LU mais d'une fiabilité douteuse (typiquement manuscrit) : la
    # valeur est proposée, l'utilisateur confirme ou corrige.
    champ_a_confirmer = "champ_a_confirmer"
    doublon = "doublon"


class WritingMode(str, Enum):
    """Mode d'écriture du document, tel que rapporté par la lecture."""

    imprime = "imprime"
    manuscrit = "manuscrit"
    mixte = "mixte"          # formulaire imprimé rempli à la main


# --- État du graphe LangGraph ------------------------------------------------
class GraphState(TypedDict, total=False):
    """État partagé circulant entre les nœuds LangGraph.

    `total=False` : chaque nœud n'écrit que les clés qu'il modifie.
    """

    user_id: str
    document_id: str
    filename: Optional[str]
    mime: Optional[str]
    file_b64: Optional[str]          # contenu source encodé base64 (entrée OCR)

    ocr_text: str                    # texte de travail (français)
    ocr_text_original: Optional[str] # texte OCR d'origine avant traduction
    detected_language: Optional[str]
    document_type: Optional[str]     # 'facture' | 'virement' | 'contrat' | 'autre'
    detected_nature: Optional[str]   # nature devinée si document_type == 'autre'
    message: Optional[str]           # explication d'un dénouement non erroné

    # Lecture manuscrite : mode d'écriture rapporté, et champs dont la valeur a
    # été lue mais reste douteuse (à faire confirmer par l'utilisateur).
    writing_mode: Optional[str]              # valeur de WritingMode
    uncertain_fields: List[str]

    invoice: Dict[str, Any]          # Invoice sérialisée (dict), mise à jour incrémentale
    virement: Dict[str, Any]         # BankTransfer sérialisé (branche virement)
    contrat: Dict[str, Any]          # Contract sérialisé (branche contrat)
    missing_fields: List[str]
    field_suggestions: Dict[str, List[str]]  # candidats par champ manquant (HITL assisté)
    virement_missing_fields: List[str]                 # HITL virement
    virement_field_suggestions: Dict[str, List[str]]   # suggestions HITL virement
    contrat_missing_fields: List[str]                  # HITL contrat
    contrat_field_suggestions: Dict[str, List[str]]    # suggestions HITL contrat

    analysis: Optional[str]
    expense_category: Optional[str]
    incoherences: List[str]              # anomalies déterministes détectées (❗)
    payment: Dict[str, Any]             # {paid, payment_date, days_until, note}

    duplicate_candidate: Optional[Dict[str, Any]]
    duplicate_decision: Optional[str]   # 'confirme' | 'distinct' | None

    saved: Optional[bool]
    duplicate_skipped: Optional[bool]

    status: str                          # statut interne
    error: Optional[str]
    messages: List[Dict[str, str]]


# --- Contrats API ------------------------------------------------------------
class PendingQuestion(BaseModel):
    """Détail d'une interruption HITL (champ manquant ou doublon)."""

    type: PendingType
    question: str
    field: Optional[str] = None
    suggestions: Optional[List[str]] = None             # champ manquant : candidats proposés
    existing_invoice: Optional[Dict[str, Any]] = None   # doublon : l'existant
    new_invoice: Optional[Dict[str, Any]] = None        # doublon : le nouveau


class AnalyzeResponse(BaseModel):
    status: Status
    thread_id: str
    document_id: Optional[str] = None
    document_type: Optional[str] = None       # 'facture' | 'virement' | 'contrat'
    # Rempli si status == completed
    invoice: Optional[Invoice] = None
    transfer: Optional[BankTransfer] = None   # rempli si document_type == 'virement'
    contract: Optional[Contract] = None       # rempli si document_type == 'contrat'
    analysis: Optional[str] = None
    expense_category: Optional[str] = None
    incoherences: Optional[List[str]] = None
    paid: Optional[bool] = None
    payment_date: Optional[str] = None
    payment_days_until: Optional[int] = None
    saved: Optional[bool] = None
    duplicate_skipped: Optional[bool] = None
    # Rempli si status == en_attente_utilisateur
    pending: Optional[PendingQuestion] = None
    # Rempli si status == erreur
    error: Optional[str] = None
    # Explication d'un dénouement qui n'est PAS une erreur (document non pris
    # en charge) : `error` resterait vide, il ne s'est rien produit d'anormal.
    message: Optional[str] = None
    # Nature devinée d'un document non pris en charge (« carte d'identité »…).
    detected_nature: Optional[str] = None


class AnswerRequest(BaseModel):
    thread_id: str
    answer: str


class AnswerResponse(BaseModel):
    status: Status
    thread_id: str
    document_id: Optional[str] = None
    # Reprise d'un flux d'analyse (même forme que AnalyzeResponse)
    analyze: Optional[AnalyzeResponse] = None
    # Réponse à une question de suivi (Q&A) sur une facture déjà traitée
    answer: Optional[str] = None
    error: Optional[str] = None


class QARequest(BaseModel):
    """Question de suivi sur une facture déjà enregistrée (par document_id)."""

    user_id: str
    document_id: str
    question: str


class QAResponse(BaseModel):
    status: Status
    document_id: Optional[str] = None
    answer: Optional[str] = None
    error: Optional[str] = None


class InvoiceListItem(BaseModel):
    document_id: str
    invoice: Invoice
    analysis: Optional[str] = None
    expense_category: Optional[str] = None
    incoherences: Optional[List[str]] = None
    paid: Optional[bool] = None
    payment_date: Optional[str] = None
    payment_days_until: Optional[int] = None
    created_at: Optional[str] = None
    filename: Optional[str] = None
    has_file: bool = False


class VirementListItem(BaseModel):
    document_id: str
    transfer: BankTransfer
    analysis: Optional[str] = None
    incoherences: Optional[List[str]] = None
    created_at: Optional[str] = None
    filename: Optional[str] = None
    has_file: bool = False


class ContratListItem(BaseModel):
    document_id: str
    contract: Contract
    analysis: Optional[str] = None
    incoherences: Optional[List[str]] = None
    created_at: Optional[str] = None
    filename: Optional[str] = None
    has_file: bool = False


class CadeauListItem(BaseModel):
    document_id: str
    cadeau: Cadeau
    analysis: Optional[str] = None
    incoherences: Optional[List[str]] = None
    created_at: Optional[str] = None
    filename: Optional[str] = None
    has_file: bool = False


class EstimationCadeau(BaseModel):
    """Sortie de l'estimation par vision — une suggestion, jamais une déclaration.

    `message` porte la phrase affichée à l'utilisateur : elle est construite côté
    serveur pour que l'avertissement suive toujours la valeur, quel que soit le
    client qui l'affiche.
    """

    objet_identifie: Optional[str] = None
    description: Optional[str] = None
    marque: Optional[str] = None
    valeur_estimee: Optional[float] = None
    fourchette_min: Optional[float] = None
    fourchette_max: Optional[float] = None
    confiance: str = "faible"                # 'haute' | 'moyenne' | 'faible'
    message: str
    avertissement: str
    source_estimation: str = "vision-mistral"


class DocumentDetail(BaseModel):
    """Vue complète d'un document déjà traité, pour la consultation a posteriori.

    Réunit facture, virement, contrat et cadeau derrière un seul contrat d'API :
    `document_type` indique lequel de `invoice` / `transfer` / `contract` /
    `cadeau` est rempli.
    """

    document_id: str
    document_type: str                       # 'facture' | 'virement' | 'contrat'
    filename: Optional[str] = None
    mime: Optional[str] = None
    has_file: bool = False                   # pièce d'origine consultable
    created_at: Optional[str] = None
    analysis: Optional[str] = None
    incoherences: Optional[List[str]] = None
    # Repli d'aperçu quand l'original n'a pas été conservé (documents antérieurs).
    ocr_text: Optional[str] = None
    detected_language: Optional[str] = None
    # Lecture manuscrite : mode d'écriture et champs confirmés par l'utilisateur
    # parce que leur lecture était douteuse.
    writing_mode: Optional[str] = None
    uncertain_fields: Optional[List[str]] = None
    # Champs corrigés à la main : leur valeur ne vient plus de la machine.
    corrected_fields: Optional[List[str]] = None
    # Champs que l'utilisateur peut corriger pour ce type de document.
    editable_fields: List[str] = Field(default_factory=list)
    # Rempli si document_type == 'facture'
    invoice: Optional[Invoice] = None
    expense_category: Optional[str] = None
    paid: Optional[bool] = None
    payment_date: Optional[str] = None
    payment_days_until: Optional[int] = None
    # Rempli si document_type == 'virement'
    transfer: Optional[BankTransfer] = None
    # Rempli si document_type == 'contrat'
    contract: Optional[Contract] = None
    # Rempli si document_type == 'cadeau'
    cadeau: Optional[Cadeau] = None
