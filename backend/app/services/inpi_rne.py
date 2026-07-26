import httpx

from app.services.recherche import fetch_company_by_siren


async def fetch_rne(siren: str, company_data: dict | None = None) -> dict:
    """Retourne les données RNE/INPI pour un SIREN via l'API recherche-entreprises (sans auth).
    
    L'API agrège les données INSEE + RNE donc nous pouvons extraire les infos
    de forme juridique, statut de radiation, et activité déclarée.
    """
    siren = siren.replace(" ", "")

    if company_data is None:
        try:
            company_data = await fetch_company_by_siren(siren)
        except httpx.HTTPError as e:
            return {"found": False, "error": str(e)}

    if not company_data:
        return {"found": False}

    etat = company_data.get("etat_administratif")
    # "A" = actif, "F" = fermé/radié
    radiee = etat == "F"

    complements = company_data.get("complements", {})
    nature_juridique = company_data.get("nature_juridique")

    # Map nature_juridique code to a readable label when possible
    forme_juridique = _map_nature_juridique(nature_juridique)

    return {
        "found": True,
        "siren": siren,
        "forme_juridique": forme_juridique,
        "nature_juridique_code": nature_juridique,
        "date_immatriculation": company_data.get("date_creation"),
        "activite_declaree": company_data.get("activite_principale"),
        "etat_administratif": etat,
        "radiee": radiee,
        "est_association": complements.get("est_association", False),
        "est_entrepreneur_individuel": complements.get("est_entrepreneur_individuel", False),
    }


def _map_nature_juridique(code: str | None) -> str | None:
    """Convertit le code nature juridique INSEE en libellé lisible."""
    if not code:
        return None
    _LABELS = {
        "1000": "Entrepreneur individuel",
        "5499": "Société à responsabilité limitée (SARL)",
        "5710": "Société anonyme (SA)",
        "5720": "Société par actions simplifiée (SAS)",
        "5485": "Société coopérative",
        "9220": "Association loi 1901",
        "5510": "Société anonyme à conseil d'administration",
        "5543": "Société à responsabilité limitée (SARL)",
        "5308": "SARL",
        "5410": "SA à conseil d'administration",
        "5415": "SA à directoire",
        "5499": "SARL",
        "5505": "SAS",
        "5516": "SAS",
        "5517": "SAS",
        "5518": "SAS",
        "5519": "SAS",
        "5531": "SA",
        "5532": "SA",
        "5533": "SA",
        "5534": "SA",
        "5585": "Société en commandite par actions",
        "6540": "GIE",
    }
    return _LABELS.get(code, f"Forme juridique code {code}")