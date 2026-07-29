"""Serveur MCP — Entreprises (INSEE / INPI).

Expose l'API publique officielle recherche-entreprises.api.gouv.fr (données Sirene INSEE +
Annuaire des entreprises), sans clé, ~7 req/s. Utile pour l'onboarding : vérifier si un
créateur a déjà un SIREN, récupérer son code APE/NAF, sa forme juridique, son état administratif.

INPI : le Guichet unique (formalites.entreprises.gouv.fr) n'expose pas d'API publique de contenu ;
on fournit donc l'URL de démarche via inpi_guichet_unique() (lien fiable pour la roadmap).
"""

import httpx
from mcp.server.fastmcp import FastMCP

API = "https://recherche-entreprises.api.gouv.fr/search"
mcp = FastMCP("entreprises")


@mcp.tool()
async def rechercher_entreprise(requete: str, limite: int = 5) -> dict:
    """Recherche une entreprise/entrepreneur par nom, SIREN, SIRET ou adresse (données Sirene INSEE).

    Args:
        requete: nom, SIREN (ex "siren:130025265"), ou termes libres.
        limite: nombre de résultats.
    Returns: {"resultats": [{"nom","siren","siret_siege","code_naf","libelle_naf",
              "forme_juridique","etat_administratif","date_creation"}]}
    """
    params = {"q": requete, "per_page": min(limite, 25), "page": 1}
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(API, params=params)
        r.raise_for_status()
        data = r.json()

    resultats = []
    for e in data.get("results", []):
        siege = e.get("siege", {}) or {}
        resultats.append(
            {
                "nom": e.get("nom_complet") or e.get("nom_raison_sociale"),
                "siren": e.get("siren"),
                "siret_siege": siege.get("siret"),
                "code_naf": e.get("activite_principale") or siege.get("activite_principale"),
                "libelle_naf": e.get("libelle_activite_principale")
                or siege.get("libelle_activite_principale"),
                "forme_juridique": e.get("nature_juridique"),
                "etat_administratif": e.get("etat_administratif"),
                "date_creation": e.get("date_creation"),
            }
        )
    return {"resultats": resultats, "total": data.get("total_results"), "source": "INSEE / Annuaire des entreprises"}


@mcp.tool()
def inpi_guichet_unique() -> dict:
    """Retourne les liens officiels INPI pour créer/modifier une entreprise (démarches)."""
    return {
        "creation": "https://formalites.entreprises.gouv.fr",
        "procedures": "https://procedures.inpi.fr",
        "aide": "https://entreprendre.service-public.fr/vosdroits/F32919",
        "note": "Le Guichet unique (INPI) est le point de passage obligatoire depuis 2023 pour "
        "toute création. Il n'existe pas d'API publique de contenu ; ces liens sont les démarches.",
        "source": "INPI",
    }


if __name__ == "__main__":
    mcp.run()
