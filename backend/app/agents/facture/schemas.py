"""Schémas de la facture émise (émetteur = l'utilisateur, destinataire = son client).

Distinct des `invoices` de l'app capture (factures REÇUES, dédupliquées par fournisseur) : ici
l'utilisateur est l'émetteur, la facture est GÉNÉRÉE par la plateforme, jamais analysée par OCR.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


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


class ClientFacture(BaseModel):
    """Identité de l'acheteur — mentions obligatoires côté client (fiche F31808)."""

    nom: str = Field(min_length=1)
    est_professionnel: bool = False
    adresse: str | None = None
    numero_tva_intracom: str | None = None  # si redevable de la TVA (auto-liquidation)


class FactureRequest(BaseModel):
    """Entrée utilisateur : rien d'autre n'est nécessaire, l'émetteur vient du profil (SIREN)."""

    client: ClientFacture
    lignes: list[LigneFacture] = Field(min_length=1)
    date_prestation: date | None = None  # défaut : date d'émission
    numero_bon_commande: str | None = None
    conditions_escompte: str | None = None  # texte libre ; sinon mention légale par défaut
    membre_association_agreee: bool = False


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
    numero: str  # séquence chronologique continue, jamais de trou (obligation légale)
    date_emission: date
    date_prestation: date

    # Émetteur — dérivé du profil UserProfile, jamais ressaisi.
    emetteur_nom: str
    emetteur_forme_juridique: str | None = None
    emetteur_siren: str
    emetteur_adresse: str | None = None
    emetteur_capital_social: str | None = None
    emetteur_franchise_tva: bool  # régime micro sans option TVA -> mention art. 293 B CGI

    client: ClientFacture
    lignes: list[LigneFacture]

    total_ht: float
    total_tva: float
    total_ttc: float
    tva_intracom_requise: bool  # total HT > 150 € (fiche F31808)

    mentions: list[MentionFacture]

    template_source: str = "standard"  # "standard" | "upload" (voir garde-fous 1.1)
    template_upload_note: str | None = None  # motif du repli, si un template a été tenté

    created_at: str
