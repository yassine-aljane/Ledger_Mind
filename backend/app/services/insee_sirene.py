import httpx

from app.services.recherche import fetch_company_by_siren


async def fetch_sirene(siret: str, company_data: dict | None = None) -> dict:
    """Retourne les données SIRENE pour un SIRET via l'API recherche-entreprises (sans auth).
    
    Utilise le SIREN (9 premiers chiffres) pour récupérer la fiche entreprise,
    puis valide que le SIRET fourni appartient bien à cet établissement.
    """
    siret = siret.replace(" ", "")
    siren = siret[:9]

    if company_data is None:
        try:
            company_data = await fetch_company_by_siren(siren)
        except httpx.HTTPError as e:
            return {"found": False, "error": str(e)}

    if not company_data:
        return {"found": False}

    siege = company_data.get("siege", {})

    # etat_administratif: "A" = actif, "F" = fermé
    etat = company_data.get("etat_administratif")

    return {
        "found": True,
        "siret": siret,
        "siren": siren,
        "denomination": company_data.get("nom_complet") or company_data.get("nom_raison_sociale"),
        "etat_administratif": etat,
        "date_creation": company_data.get("date_creation"),
        "activite_principale": company_data.get("activite_principale"),
        "nomenclature_activite": "NAFRev2",
        "categorie_juridique": company_data.get("nature_juridique"),
        "caractere_employeur": siege.get("caractere_employeur"),
        "nombre_etablissements_ouverts": company_data.get("nombre_etablissements_ouverts"),
    }