"""Schémas de la facture émise (émetteur = l'utilisateur, destinataire = son client).

Distinct des `invoices` de l'app capture (factures REÇUES, dédupliquées par fournisseur) : ici
l'utilisateur est l'émetteur, la facture est GÉNÉRÉE par la plateforme, jamais analysée par OCR.

Cycle de vie
------------
    brouillon  →  emise  →  payee | partiellement_payee
                    ↓
                 annulee  (uniquement par un AVOIR, jamais par suppression)

Le brouillon n'a PAS de numéro : il n'a aucune existence fiscale et se modifie librement.
L'émission attribue le numéro de séquence, verrouille le document et le rend immuable —
c'est ce jalon, et lui seul, que l'agent de rapprochement bancaire doit compter comme
chiffre d'affaires facturé.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

StatutFacture = Literal[
    "brouillon",             # généré, modifiable, SANS numéro légal
    "emise",                 # numérotée, verrouillée, immuable
    "partiellement_payee",
    "payee",
    "annulee",               # annulée par un avoir ; le document reste archivé
]

TypeDocument = Literal["facture", "avoir"]


class LigneFacture(BaseModel):
    """Une ligne de désignation — le calcul (HT, TVA, TTC) se fait en code, jamais par le LLM.

    `categorie` distingue prestation de service et vente de bien : c'est ce qui permet au rapport
    d'activité (chantier 2) de ventiler le chiffre d'affaires exactement comme le fait déjà le
    moteur de feuille de route (seuils micro-BNC vs micro-BIC distincts selon la nature réelle).
    """

    designation: str = Field(min_length=1)
    quantite: float = Field(default=1, gt=0)
    prix_unitaire_ht: float = Field(ge=0)
    categorie: Literal["prestation", "vente"] = "prestation"
    taux_tva: float = Field(default=0.0, ge=0, le=1)  # 0.20, 0.10… ; 0 si franchise ou taux nul
    remise_pourcent: float = Field(default=0.0, ge=0, le=100)


class ClientFacture(BaseModel):
    """Identité de l'acheteur — mentions obligatoires côté client (fiche F31808)."""

    nom: str = Field(min_length=1)
    est_professionnel: bool = False
    adresse: str | None = None
    siret: str | None = None                # obligatoire en B2B (fiche F31808)
    numero_tva_intracom: str | None = None  # si redevable de la TVA (auto-liquidation)


class Acompte(BaseModel):
    """Acompte déjà facturé, à déduire du solde.

    `facture_numero` référence la facture d'acompte : sans elle, la déduction ne serait
    pas traçable pour un contrôle.
    """

    montant_ttc: float = Field(gt=0)
    facture_numero: str | None = None
    date_versement: date | None = None


class FactureRequest(BaseModel):
    """Entrée utilisateur : rien d'autre n'est nécessaire, l'émetteur vient du profil (SIREN)."""

    client: ClientFacture
    lignes: list[LigneFacture] = Field(min_length=1)
    date_prestation: date | None = None  # défaut : date d'émission
    numero_bon_commande: str | None = None
    numero_contrat: str | None = None    # traçabilité vers le contrat source
    conditions_escompte: str | None = None  # texte libre ; sinon mention légale par défaut
    membre_association_agreee: bool = False
    delai_paiement_jours: int | None = Field(default=None, ge=0, le=365)
    date_echeance: date | None = None    # prioritaire sur le délai si fournie
    mode_paiement: str | None = None
    acompte: Acompte | None = None


class MentionFacture(BaseModel):
    """Une mention légale telle qu'affichée sur le document, avec sa justification.

    `source` pointe vers l'obligation qui l'exige (fiche F31808 ou l'article du CGI) : la
    traçabilité vaut aussi bien pour le développeur qui audite que pour l'utilisateur qui veut
    vérifier qu'aucune mention n'a été inventée.
    """

    cle: str
    libelle: str
    valeur: str
    source: str


class Facture(BaseModel):
    """Facture entièrement calculée — ce que le PDF rend, tel quel."""

    id: str
    uid: str
    # `None` tant que le document est un brouillon : un numéro consommé puis abandonné
    # créerait un trou dans la séquence, ce que la loi interdit.
    numero: str | None = None
    type_document: TypeDocument = "facture"
    statut: StatutFacture = "brouillon"
    date_emission: date | None = None    # posée à l'émission, pas à la création
    date_prestation: date

    # Émetteur — dérivé du profil UserProfile, jamais ressaisi.
    emetteur_nom: str
    emetteur_forme_juridique: str | None = None
    emetteur_siren: str
    emetteur_adresse: str | None = None
    emetteur_capital_social: str | None = None
    emetteur_franchise_tva: bool  # régime micro sans option TVA -> mention art. 293 B CGI
    # Vrai quand le régime n'est pas encore qualifié : la facture porte alors une mention
    # « à préciser » plutôt que de rester muette sur la TVA, ce qui ne serait pas conforme.
    regime_tva_indetermine: bool = False
    emetteur_tva_intracom: str | None = None
    emetteur_iban: str | None = None
    emetteur_rc_pro: str | None = None     # n° de police, si l'activité l'exige

    client: ClientFacture
    lignes: list[LigneFacture]

    total_ht: float
    total_tva: float
    total_ttc: float
    acompte: Acompte | None = None
    net_a_payer: float                     # TTC moins l'acompte déjà versé
    montant_regle: float = 0.0             # cumul des règlements constatés
    tva_intracom_requise: bool  # total HT > seuil de dispense (fiche F31808)

    # Règlement
    date_echeance: date | None = None
    delai_paiement_jours: int | None = None
    mode_paiement: str | None = None

    # Traçabilité
    numero_contrat: str | None = None
    numero_bon_commande: str | None = None
    facture_origine_numero: str | None = None   # rempli sur un AVOIR
    avoir_numero: str | None = None             # rempli sur la facture annulée

    mentions: list[MentionFacture]

    template_source: str = "standard"  # "standard" | "upload" (voir garde-fous 1.1)
    template_upload_note: str | None = None  # motif du repli, si un template a été tenté

    created_at: str
    updated_at: str | None = None
