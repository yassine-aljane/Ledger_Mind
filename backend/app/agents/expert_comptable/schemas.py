"""Schémas de la recherche d'experts-comptables — présentation neutre, sources officielles.

Distinct de `app.agents.referral` : cet agent n'utilise QUE des sources officielles/ouvertes
(API Recherche d'Entreprises, Overpass/OpenStreetMap) et ne scrape jamais un site pour compléter
un email — contrainte explicite (4.2). `referral` reste inchangé pour son propre usage.
"""

from __future__ import annotations

from pydantic import BaseModel


class CabinetComptable(BaseModel):
    """Un cabinet réellement trouvé — aucun champ n'est inventé ; absent = None, pas deviné."""

    nom_cabinet: str
    adresse: str | None = None
    telephone: str | None = None
    site_web: str | None = None
    email: str | None = None
    distance_km: float | None = None
    source: str  # "Recherche d'Entreprises (api.gouv.fr)" | "OpenStreetMap (Overpass)"


class RechercheExpertsComptables(BaseModel):
    ville_recherchee: str
    cabinets: list[CabinetComptable]
    sources: list[str]
    annuaire_officiel_url: str
    annuaire_officiel_label: str
    avertissement: str
