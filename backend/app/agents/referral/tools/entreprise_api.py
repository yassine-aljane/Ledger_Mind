"""Recherche de cabinets comptables enregistrés via l'API Recherche d'Entreprises
(data.gouv.fr / INSEE-INPI). Gratuit, officiel, sans clé API.
Filtre sur le code NAF 69.20Z (activités comptables).
Ne fournit PAS d'email directement (données légales uniquement) - sert à
compléter/vérifier les résultats d'Overpass. Passe les coordonnées du siège
quand l'API les expose, pour la carte.
"""
import requests
from typing import List, Optional
from ..config import ENTREPRISE_API_URL


def search_entreprise_api(ville: str, code_postal: Optional[str] = None) -> List[dict]:
    params = {
        "q": "comptable",
        "activite_principale": "69.20Z",
        "limite_matching_etablissements": 1,
        "per_page": 10,
    }
    if code_postal:
        params["code_postal"] = code_postal

    try:
        resp = requests.get(ENTREPRISE_API_URL, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        raise RuntimeError(f"Erreur API Recherche d'Entreprises: {e}")

    results = []
    for r in data.get("results", []):
        nom = r.get("nom_complet") or r.get("nom_raison_sociale")
        if not nom:
            continue
        siege = r.get("siege", {}) or {}
        lat = siege.get("latitude")
        lon = siege.get("longitude")
        try:
            lat_f = float(lat) if lat is not None else None
            lon_f = float(lon) if lon is not None else None
        except (TypeError, ValueError):
            lat_f, lon_f = None, None
        results.append({
            "nom_cabinet": nom,
            "email": None,  # non fourni par cette API
            "site_web": None,
            "telephone": None,
            "adresse": siege.get("adresse"),
            "lat": lat_f,
            "lon": lon_f,
            "source": "entreprise_api",
        })
    return results
