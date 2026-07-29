"""Géocodage d'une ville française en (latitude, longitude, code_postal).

Priorité : API Adresse (data.gouv.fr) — officielle, gratuite, sans clé.
Secours : Nominatim (OpenStreetMap) si l'API Adresse ne trouve rien.
"""
import requests

from ..config import ADRESSE_API_URL, NOMINATIM_URL, NOMINATIM_USER_AGENT


def _geocode_via_adresse(ville: str) -> dict | None:
    """API Adresse data.gouv.fr — adaptée aux communes françaises."""
    params = {"q": ville, "limit": 1, "type": "municipality"}
    try:
        resp = requests.get(ADRESSE_API_URL, params=params, timeout=10)
        resp.raise_for_status()
        features = resp.json().get("features", [])
    except requests.RequestException:
        return None

    if not features:
        return None

    props = features[0].get("properties", {})
    coords = features[0].get("geometry", {}).get("coordinates")
    if not coords or len(coords) < 2:
        return None

    lon, lat = float(coords[0]), float(coords[1])
    return {
        "lat": lat,
        "lon": lon,
        "code_postal": props.get("postcode"),
        "label": props.get("label") or props.get("city") or ville,
    }


def _geocode_via_nominatim(ville: str) -> dict | None:
    """Secours Nominatim — nécessite un User-Agent identifiant valide."""
    params = {
        "q": f"{ville}, France",
        "format": "json",
        "addressdetails": 1,
        "limit": 1,
        "countrycodes": "fr",
    }
    headers = {
        "User-Agent": NOMINATIM_USER_AGENT,
        "Accept": "application/json",
        "Accept-Language": "fr",
    }

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


def geocode_ville(ville: str) -> dict | None:
    """Retourne {"lat", "lon", "code_postal", "label"} ou None si introuvable."""
    ville = ville.strip()
    if not ville:
        return None

    result = _geocode_via_adresse(ville)
    if result is not None:
        return result

    return _geocode_via_nominatim(ville)
