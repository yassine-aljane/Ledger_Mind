"""Agent de recherche : trouve des cabinets comptables dans une ville donnée
et complète les emails manquants. 100% gratuit (Nominatim + Overpass + API
Recherche d'Entreprises + scraping léger des sites officiels).

Les appels réseau lents (Overpass / Entreprises / DuckDuckGo / scraping) sont
parallélisés pour éviter le waterfall de 30–60 s.
"""
from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List

from .config import MAX_RESULTS
from .state import AgentState, Comptable
from .tools.geocode import geocode_ville
from .tools.overpass import search_overpass
from .tools.entreprise_api import search_entreprise_api
from .tools.email_scraper import extract_email_from_website
from .tools.web_search import find_website

# Capacité du pool : assez pour Overpass+API puis enrichissement des cabinets,
# sans saturer les APIs gratuites.
_IO_WORKERS = 6


def _dedupe(comptables: List[dict]) -> List[dict]:
    seen = set()
    unique = []
    for c in comptables:
        key = c["nom_cabinet"].strip().lower()
        if key not in seen:
            seen.add(key)
            unique.append(c)
    return unique


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return round(r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)), 1)


def _safe_overpass(lat: float, lon: float) -> list[dict]:
    try:
        return search_overpass(lat, lon)
    except RuntimeError:
        return []


def _safe_entreprise(ville: str, code_postal: str | None) -> list[dict]:
    try:
        return search_entreprise_api(ville, code_postal)
    except RuntimeError:
        return []


def _enrich_cabinet(c: dict, ville: str, geo_lat: float, geo_lon: float) -> Comptable:
    """Complète site/email manquants pour UN cabinet (appelée en parallèle)."""
    email = c.get("email")
    site_web = c.get("site_web")

    if not email and not site_web:
        site_web = find_website(c["nom_cabinet"], ville)

    if not email and site_web:
        email = extract_email_from_website(site_web)

    el_lat = c.get("lat")
    el_lon = c.get("lon")
    distance = None
    if el_lat is not None and el_lon is not None:
        distance = _distance_km(geo_lat, geo_lon, el_lat, el_lon)

    return {
        "nom_cabinet": c["nom_cabinet"],
        "ville": ville,
        "email": email,
        "site_web": site_web,
        "telephone": c.get("telephone"),
        "adresse": c.get("adresse"),
        "lat": el_lat,
        "lon": el_lon,
        "distance_km": distance,
        "source": c["source"],
    }


def search_agent_node(state: AgentState) -> AgentState:
    ville = state["ville"].strip()

    if not ville:
        state["error"] = "region_trop_vague"
        state["status"] = "echec"
        return state

    # 1. Géocodage de la ville
    try:
        geo = geocode_ville(ville)
    except RuntimeError as e:
        state["error"] = f"erreur_geocodage: {e}"
        state["status"] = "echec"
        return state

    if geo is None:
        state["error"] = "region_trop_vague"
        state["status"] = "echec"
        return state

    state["ville_lat"] = geo["lat"]
    state["ville_lon"] = geo["lon"]

    # 2. Overpass + API Entreprises EN PARALLÈLE (avant : ~séquentiel 5–20 s)
    with ThreadPoolExecutor(max_workers=2) as pool:
        fut_osm = pool.submit(_safe_overpass, geo["lat"], geo["lon"])
        fut_ent = pool.submit(_safe_entreprise, ville, geo.get("code_postal"))
        overpass_results = fut_osm.result()
        entreprise_results = fut_ent.result()

    combined = _dedupe(overpass_results + entreprise_results)[:MAX_RESULTS]

    if not combined:
        state["error"] = "aucun_comptable_trouve"
        state["status"] = "echec"
        return state

    # 3. Enrichissement site/email EN PARALLÈLE (avant : N × DuckDuckGo × scraping)
    comptables: List[Comptable] = [None] * len(combined)  # type: ignore[list-item]
    with ThreadPoolExecutor(max_workers=min(_IO_WORKERS, len(combined))) as pool:
        futures = {
            pool.submit(_enrich_cabinet, c, ville, geo["lat"], geo["lon"]): idx
            for idx, c in enumerate(combined)
        }
        for fut in as_completed(futures):
            idx = futures[fut]
            try:
                comptables[idx] = fut.result()
            except Exception:
                # Un cabinet en échec ne doit pas faire tomber toute la recherche.
                c = combined[idx]
                comptables[idx] = {
                    "nom_cabinet": c["nom_cabinet"],
                    "ville": ville,
                    "email": c.get("email"),
                    "site_web": c.get("site_web"),
                    "telephone": c.get("telephone"),
                    "adresse": c.get("adresse"),
                    "lat": c.get("lat"),
                    "lon": c.get("lon"),
                    "distance_km": None,
                    "source": c["source"],
                }

    state["comptables"] = [c for c in comptables if c is not None]
    state["status"] = "en_cours"
    state["error"] = None
    return state
