"""Géocodage d'une ville française en (latitude, longitude, code_postal) via Nominatim.
Gratuit, sans clé API. Limite d'usage : 1 requête/seconde (politique Nominatim).
"""
import requests
from typing import Optional, Tuple
from config import NOMINATIM_URL, NOMINATIM_USER_AGENT


def geocode_ville(ville: str) -> Optional[dict]:
    """Retourne {"lat": float, "lon": float, "code_postal": str|None, "label": str} ou None."""
    params = {
        "q": f"{ville}, France",
        "format": "json",
        "addressdetails": 1,
        "limit": 1,
        "countrycodes": "fr",
    }
    headers = {"User-Agent": NOMINATIM_USER_AGENT}

    try:
        resp = requests.get(NOMINATIM_URL, params=params, headers=headers, timeout=10)
        resp.raise_for_status()
        results = resp.json()
    except requests.RequestException as e:
        raise RuntimeError(f"Erreur de géocodage pour '{ville}': {e}")

    if not results:
        return None

    r = results[0]
    address = r.get("address", {})
    return {
        "lat": float(r["lat"]),
        "lon": float(r["lon"]),
        "code_postal": address.get("postcode"),
        "label": r.get("display_name", ville),
    }
