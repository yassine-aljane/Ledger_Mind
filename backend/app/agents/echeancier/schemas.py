"""Schémas du moteur d'échéances — voir moteur.py pour le Decision Engine."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

StatutEcheance = Literal["a_venir", "urgent", "en_retard", "regularisee"]
PalierAlerte = Literal["J-30", "J-15", "J-7", "J-3", "J-1", "jour_j", "retard", None]


class Echeance(BaseModel):
    id: str  # clé naturelle : {obligation_id}:{periode}
    obligation_id: str
    libelle: str
    periode: str  # étiquette lisible, ex. "juillet 2026" ou "2026"
    date_limite: str | None = None  # ISO — None si seule une fenêtre indicative est connue
    fenetre_indicative: str | None = None
    statut: StatutEcheance
    palier_alerte: PalierAlerte = None
    portail_paiement: str
    portail_label: str
    source: str
    regularisee_le: str | None = None


class MarquerPayeRequest(BaseModel):
    periode: str


class ParametresCalendrier(BaseModel):
    periodicite_urssaf: Literal["mensuelle", "trimestrielle"] | None = None
    regime_tva: Literal["franchise", "reel_simplifie", "reel_normal"] | None = None
    numero_tva_intracommunautaire: str | None = None
    revenus_intracommunautaires: bool | None = None
    versement_liberatoire: bool | None = None


class AgendaResponse(BaseModel):
    echeances: list[Echeance]
    parametres_manquants: list[str]


class HistoriqueItem(BaseModel):
    type: Literal["facture", "rapport", "declaration", "echeance"]
    id: str
    libelle: str
    date: str
    statut: str
    montant: float | None = None
