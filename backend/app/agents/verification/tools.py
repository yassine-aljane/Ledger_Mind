from app.services.insee_sirene import fetch_sirene
from app.services.inpi_rne import fetch_rne


async def check_sirene(siret: str) -> dict:
    """Interroge l'API SIRENE de l'INSEE pour un SIRET donné.

    Args:
        siret: Le numéro SIRET à vérifier (14 chiffres, avec ou sans espaces).

    Returns:
        Un dictionnaire avec denomination, etat_administratif ('A'=actif/'F'=fermé),
        date_creation, activite_principale, categorie_juridique.
        Si l'entité n'existe pas: {"found": False}.
    """
    return await fetch_sirene(siret)


async def check_rne(siren: str) -> dict:
    """Interroge le RNE (INPI) pour un SIREN donné.

    Args:
        siren: Le numéro SIREN (9 premiers chiffres du SIRET).

    Returns:
        Un dictionnaire avec forme_juridique, date_immatriculation,
        activite_declaree, radiee (bool).
        Si l'entité n'existe pas: {"found": False}.
    """
    return await fetch_rne(siren)