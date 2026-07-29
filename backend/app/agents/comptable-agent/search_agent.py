"""Agent de recherche : trouve des cabinets comptables dans une ville donnée
et complète les emails manquants. 100% gratuit (Nominatim + Overpass + API
Recherche d'Entreprises + scraping léger des sites officiels).
"""
from typing import List
from config import MAX_RESULTS
from state import AgentState, Comptable
from tools.geocode import geocode_ville
from tools.overpass import search_overpass
from tools.entreprise_api import search_entreprise_api
from tools.email_scraper import extract_email_from_website
from tools.web_search import find_website


def _dedupe(comptables: List[dict]) -> List[dict]:
    seen = set()
    unique = []
    for c in comptables:
        key = c["nom_cabinet"].strip().lower()
        if key not in seen:
            seen.add(key)
            unique.append(c)
    return unique


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
        # Ville introuvable / trop vague (ex. faute de frappe, ville ambiguë)
        state["error"] = "region_trop_vague"
        state["status"] = "echec"
        return state

    # 2. Recherche via Overpass (source principale, donne parfois email direct)
    try:
        overpass_results = search_overpass(geo["lat"], geo["lon"])
    except RuntimeError:
        overpass_results = []

    # 3. Complément via l'API Recherche d'Entreprises (données légales officielles)
    try:
        entreprise_results = search_entreprise_api(ville, geo.get("code_postal"))
    except RuntimeError:
        entreprise_results = []

    combined = _dedupe(overpass_results + entreprise_results)[:MAX_RESULTS]

    if not combined:
        state["error"] = "aucun_comptable_trouve"
        state["status"] = "echec"
        return state

    # 4. Pour chaque cabinet sans email connu, tenter le scraping du site
    comptables: List[Comptable] = []
    for c in combined:
        email = c.get("email")
        site_web = c.get("site_web")

        # Si le site web n'est pas connu (ex. résultats de l'API entreprises),
        # on le cherche via DuckDuckGo avant de pouvoir scraper un email.
        if not email and not site_web:
            site_web = find_website(c["nom_cabinet"], ville)

        if not email and site_web:
            email = extract_email_from_website(site_web)

        comptables.append({
            "nom_cabinet": c["nom_cabinet"],
            "ville": ville,
            "email": email,
            "site_web": site_web,
            "telephone": c.get("telephone"),
            "source": c["source"],
        })

    state["comptables"] = comptables
    state["status"] = "en_cours"
    state["error"] = None
    return state