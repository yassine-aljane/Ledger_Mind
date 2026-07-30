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
    # Unification devise (FR : montant TTC converti en EUR, taux BCE à la date d'émission).
    amount_eur: Optional[float] = None
    exchange_rate: Optional[float] = None        # taux `currency` -> EUR appliqué
    rate_date: Optional[str] = None              # date du taux utilisé (ISO 'YYYY-MM-DD')
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


class BankTransfer(BaseModel):
    """Virement bancaire (cadre France). Champs absents/illisibles = None (FR-08).

    IBAN français = FR + 25 caractères (stockés sans espaces).
    """

    transfer_reference: Optional[str] = None     # référence / n° d'opération
    execution_date: Optional[str] = None         # date d'exécution (ISO 'YYYY-MM-DD')
    value_date: Optional[str] = None             # date de valeur (ISO) si présente
    amount: Optional[float] = None
    currency: Optional[str] = None               # ex. EUR
    # Unification devise (FR : montant converti en EUR, taux BCE à la date d'exécution).
    amount_eur: Optional[float] = None
    exchange_rate: Optional[float] = None        # taux `currency` -> EUR appliqué
    rate_date: Optional[str] = None              # date du taux utilisé (ISO 'YYYY-MM-DD')
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


class PendingType(str, Enum):
    champ_manquant = "champ_manquant"
    doublon = "doublon"


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
    document_type: Optional[str]     # 'facture' | 'virement' (détecté après OCR)

    invoice: Dict[str, Any]          # Invoice sérialisée (dict), mise à jour incrémentale
    virement: Dict[str, Any]         # BankTransfer sérialisé (branche virement)
    missing_fields: List[str]
    field_suggestions: Dict[str, List[str]]  # candidats par champ manquant (HITL assisté)
    virement_missing_fields: List[str]                 # HITL virement
    virement_field_suggestions: Dict[str, List[str]]   # suggestions HITL virement

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
    document_type: Optional[str] = None       # 'facture' | 'virement'
    # Rempli si status == completed
    invoice: Optional[Invoice] = None
    transfer: Optional[BankTransfer] = None   # rempli si document_type == 'virement'
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


class VirementListItem(BaseModel):
    document_id: str
    transfer: BankTransfer
    analysis: Optional[str] = None
    incoherences: Optional[List[str]] = None
    created_at: Optional[str] = None
