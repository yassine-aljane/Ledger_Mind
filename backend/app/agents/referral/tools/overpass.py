"""Recherche des cabinets comptables autour d'un point via Overpass API (OpenStreetMap).
Gratuit, sans clé API. Donne parfois directement website/email/téléphone, et toujours
les coordonnées (node ou centre d'un way) pour la carte.
"""
import requests
from typing import List
from ..config import OVERPASS_URL, SEARCH_RADIUS_M

QUERY_TEMPLATE = """
[out:json][timeout:15];
(
  node["office"="accountant"](around:{radius},{lat},{lon});
  way["office"="accountant"](around:{radius},{lat},{lon});
  node["office"="tax_advisor"](around:{radius},{lat},{lon});
);
out center tags;
"""


def _coords(el: dict) -> tuple[float | None, float | None]:
    if "lat" in el and "lon" in el:
        return float(el["lat"]), float(el["lon"])
    center = el.get("center") or {}
    if "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    return None, None


def _adresse(tags: dict) -> str | None:
    street = tags.get("addr:street")
    housenumber = tags.get("addr:housenumber")
    postcode = tags.get("addr:postcode")
    city = tags.get("addr:city")
    parts: list[str] = []
    if housenumber and street:
        parts.append(f"{housenumber} {street}")
    elif street:
        parts.append(street)
    elif tags.get("addr:full"):
        return str(tags["addr:full"])
    locality = " ".join(p for p in (postcode, city) if p)
    if locality:
        parts.append(locality)
    return ", ".join(parts) if parts else None


def search_overpass(lat: float, lon: float, radius: int = SEARCH_RADIUS_M) -> List[dict]:
    query = QUERY_TEMPLATE.format(radius=radius, lat=lat, lon=lon)

    try:
        resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=20)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        raise RuntimeError(f"Erreur Overpass API: {e}")

    results = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        nom = tags.get("name")
        if not nom:
            continue
        el_lat, el_lon = _coords(el)
        results.append({
            "nom_cabinet": nom,
            "email": tags.get("contact:email") or tags.get("email"),
            "site_web": tags.get("contact:website") or tags.get("website"),
            "telephone": tags.get("contact:phone") or tags.get("phone"),
            "adresse": _adresse(tags),
            "lat": el_lat,
            "lon": el_lon,
            "source": "overpass",
        })
    return results
