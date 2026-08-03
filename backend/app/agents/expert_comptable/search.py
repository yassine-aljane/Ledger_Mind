"""Recherche d'experts-comptables — UNIQUEMENT des sources officielles ou ouvertes.

Réutilise le géocodage et les deux sources déjà éprouvées de `app.agents.referral.tools`
(API Recherche d'Entreprises, Overpass/OpenStreetMap) — mais PAS `email_scraper`/`web_search` :
`referral` les utilise pour compléter un email en visitant le site du cabinet, ce qui reste une
forme de scraping. Cette contrainte (4.2 : « ne scrape pas ») est plus stricte ici qu'ailleurs
dans le projet, donc on ne réutilise que le sous-ensemble conforme.

Présentation neutre (4.3) : aucun tri par pertinence commerciale, seulement par distance quand
elle est connue, puis par ordre de découverte.
"""

from __future__ import annotations

import math

from app.agents.expert_comptable.schemas import CabinetComptable, RechercheExpertsComptables
from app.agents.referral.tools.entreprise_api import search_entreprise_api
from app.agents.referral.tools.geocode import geocode_ville
from app.agents.referral.tools.overpass import search_overpass

ANNUAIRE_OFFICIEL_URL = "https://annuaire.experts-comptables.org/"
ANNUAIRE_OFFICIEL_LABEL = "Annuaire officiel de l'Ordre des Experts-Comptables"

_SOURCE_ENTREPRISES = "Recherche d'Entreprises (api.gouv.fr)"
_SOURCE_OSM = "OpenStreetMap (Overpass)"

_AVERTISSEMENT = (
    "Liste indicative, sans classement commercial, construite à partir de sources publiques "
    "ouvertes. Vérifiez toujours l'inscription au tableau de l'Ordre sur l'annuaire officiel "
    "avant de confier votre dossier à un cabinet."
)


class VilleIntrouvable(ValueError):
    """La ville n'a pas pu être localisée — on ne devine jamais une position."""


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance à vol d'oiseau (haversine) — suffisant pour un tri indicatif, pas une navigation."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return round(r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)), 1)


def _depuis_overpass(resultats: list[dict], lat: float, lon: float) -> list[CabinetComptable]:
    cabinets = []
    for r in resultats:
        el_lat = r.get("lat")
        el_lon = r.get("lon")
        distance = None
        if el_lat is not None and el_lon is not None:
            distance = _distance_km(lat, lon, el_lat, el_lon)
        cabinets.append(CabinetComptable(
            nom_cabinet=r.get("nom_cabinet") or "Cabinet non nommé",
            adresse=r.get("adresse"), telephone=r.get("telephone"),
            site_web=r.get("site_web"), email=r.get("email"),
            distance_km=distance, lat=el_lat, lon=el_lon, source=_SOURCE_OSM,
        ))
    return cabinets


def _depuis_entreprise_api(resultats: list[dict], lat: float, lon: float) -> list[CabinetComptable]:
    cabinets = []
    for r in resultats:
        el_lat = r.get("lat")
        el_lon = r.get("lon")
        distance = None
        if el_lat is not None and el_lon is not None:
            distance = _distance_km(lat, lon, el_lat, el_lon)
        cabinets.append(CabinetComptable(
            nom_cabinet=r.get("nom_cabinet") or "Cabinet non nommé",
            adresse=r.get("adresse"), telephone=r.get("telephone"),
            site_web=r.get("site_web"), email=r.get("email"),
            distance_km=distance, lat=el_lat, lon=el_lon, source=_SOURCE_ENTREPRISES,
        ))
    return cabinets


def _dedupe(cabinets: list[CabinetComptable]) -> list[CabinetComptable]:
    vus: set[str] = set()
    uniques = []
    for c in cabinets:
        cle = c.nom_cabinet.strip().lower()
        if cle not in vus:
            vus.add(cle)
            uniques.append(c)
    return uniques


def rechercher(ville: str) -> RechercheExpertsComptables:
    """Recherche neutre, sans invention : une ville introuvable lève, un résultat vide reste
    vide (jamais un cabinet fabriqué pour « remplir » la liste)."""
    ville = ville.strip()
    if not ville:
        raise VilleIntrouvable("Indiquez une ville pour lancer la recherche.")

    geo = geocode_ville(ville)
    if geo is None:
        raise VilleIntrouvable(
            f"« {ville} » n'a pas pu être localisée. Précisez le département ou le code postal."
        )

    sources_utilisees: list[str] = []
    cabinets: list[CabinetComptable] = []

    try:
        bruts_osm = search_overpass(geo["lat"], geo["lon"])
        if bruts_osm:
            cabinets.extend(_depuis_overpass(bruts_osm, geo["lat"], geo["lon"]))
            sources_utilisees.append(_SOURCE_OSM)
    except RuntimeError:
        pass  # une source indisponible ne bloque pas l'autre

    try:
        bruts_api = search_entreprise_api(ville, geo.get("code_postal"))
        if bruts_api:
            cabinets.extend(_depuis_entreprise_api(bruts_api, geo["lat"], geo["lon"]))
            sources_utilisees.append(_SOURCE_ENTREPRISES)
    except RuntimeError:
        pass

    cabinets = _dedupe(cabinets)
    cabinets.sort(key=lambda c: (c.distance_km is None, c.distance_km or 0.0))

    return RechercheExpertsComptables(
        ville_recherchee=ville,
        ville_lat=geo["lat"],
        ville_lon=geo["lon"],
        cabinets=cabinets,
        sources=sources_utilisees,
        annuaire_officiel_url=ANNUAIRE_OFFICIEL_URL,
        annuaire_officiel_label=ANNUAIRE_OFFICIEL_LABEL,
        avertissement=_AVERTISSEMENT,
    )
