"""Recherche des cabinets comptables autour d'un point via Overpass API (OpenStreetMap).
Gratuit, sans clé API. Donne parfois directement website/email/téléphone.
"""
import requests
from typing import List
from ..config import OVERPASS_URL, SEARCH_RADIUS_M

QUERY_TEMPLATE = """
[out:json][timeout:25];
(
  node["office"="accountant"](around:{radius},{lat},{lon});
  way["office"="accountant"](around:{radius},{lat},{lon});
  node["office"="tax_advisor"](around:{radius},{lat},{lon});
);
out center tags;
"""


def search_overpass(lat: float, lon: float, radius: int = SEARCH_RADIUS_M) -> List[dict]:
    query = QUERY_TEMPLATE.format(radius=radius, lat=lat, lon=lon)

    try:
        resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=30)
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
        results.append({
            "nom_cabinet": nom,
            "email": tags.get("contact:email") or tags.get("email"),
            "site_web": tags.get("contact:website") or tags.get("website"),
            "telephone": tags.get("contact:phone") or tags.get("phone"),
            "source": "overpass",
        })
    return results
