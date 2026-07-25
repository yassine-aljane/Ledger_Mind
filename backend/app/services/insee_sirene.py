import httpx

from app.core.http_client import get_http_client

_BASE = "https://recherche-entreprises.api.gouv.fr"


async def fetch_sirene(siret: str) -> dict:
    """Retourne les données SIRENE pour un SIRET via l'API recherche-entreprises (sans auth).
    
    Utilise le SIREN (9 premiers chiffres) pour récupérer la fiche entreprise,
    puis valide que le SIRET fourni appartient bien à cet établissement.
    """
    siret = siret.replace(" ", "")
    siren = siret[:9]
    client = get_http_client()

    try:
        resp = await client.get(
            f"{_BASE}/search",
            params={"q": siren, "page": 1, "per_page": 1},
        )
    except httpx.HTTPError as e:
        return {"found": False, "error": str(e)}

    if resp.status_code != 200:
        return {"found": False}

    data = resp.json()
    results = data.get("results", [])

    if not results:
        return {"found": False}

    company = results[0]

    # Validate that the SIREN matches exactly
    if company.get("siren") != siren:
        return {"found": False}

    siege = company.get("siege", {})

    # etat_administratif: "A" = actif, "F" = fermé
    etat = company.get("etat_administratif")

    return {
        "found": True,
        "siret": siret,
        "siren": siren,
        "denomination": company.get("nom_complet") or company.get("nom_raison_sociale"),
        "etat_administratif": etat,
        "date_creation": company.get("date_creation"),
        "activite_principale": company.get("activite_principale"),
        "nomenclature_activite": "NAFRev2",
        "categorie_juridique": company.get("nature_juridique"),
        "caractere_employeur": siege.get("caractere_employeur"),
        "nombre_etablissements_ouverts": company.get("nombre_etablissements_ouverts"),
    }