"""Serveur MCP — BOFiP-Impôts (doctrine fiscale opposable).

Utilise l'API Opendatasoft publique de data.economie.gouv.fr (dataset "bofip-vigueur",
contenu doctrinal et actualités EN VIGUEUR). Aucune authentification requise.

Outils exposés :
  • bofip_search : recherche plein-texte dans la doctrine en vigueur
  • bofip_fetch  : récupère le contenu HTML d'un document par son identifiant

C'est la source qui tranche les cas pratiques (ex : avantages en nature des influenceurs).
"""

import re

import httpx
from mcp.server.fastmcp import FastMCP

# API Explore v2.1 Opendatasoft — dataset des publications BOFiP en vigueur
BASE = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/bofip-vigueur/records"

mcp = FastMCP("bofip")


def _strip_html(html: str) -> str:
    txt = re.sub(r"<[^>]+>", " ", html or "")
    return " ".join(txt.split())


@mcp.tool()
async def bofip_search(requete: str, limite: int = 5) -> dict:
    """Recherche plein-texte dans la doctrine fiscale BOFiP en vigueur.

    Args:
        requete: termes de recherche (ex "avantages en nature influenceur").
        limite: nombre de documents à renvoyer.
    Returns: {"documents": [{"titre","identifiant","serie","extrait","url"}]}
    """
    params = {"where": f'search(*, "{requete}")', "limit": min(limite, 20)}
    async with httpx.AsyncClient(timeout=45) as c:
        r = await c.get(BASE, params=params)
        if r.status_code != 200:
            # Repli : requête simple q= si la syntaxe where n'est pas acceptée
            r = await c.get(BASE, params={"q": requete, "limit": min(limite, 20)})
        r.raise_for_status()
        data = r.json()

    documents = []
    for rec in data.get("results", []):
        # Les champs varient selon la version du dataset : on lit défensivement.
        titre = rec.get("titre") or rec.get("title") or "Document BOFiP"
        ident = rec.get("identifiant_juridique") or rec.get("permalien") or rec.get("id") or ""
        serie = rec.get("serie") or rec.get("division") or ""
        contenu = rec.get("contenu") or rec.get("contenu_html") or rec.get("content") or ""
        documents.append(
            {
                "titre": titre,
                "identifiant": ident,
                "serie": serie,
                "extrait": _strip_html(contenu)[:1500],
                "url": rec.get("permalien")
                or (f"https://bofip.impots.gouv.fr/bofip/{ident}" if ident else "https://bofip.impots.gouv.fr"),
            }
        )
    return {"documents": documents, "source": "BOFiP"}


@mcp.tool()
async def bofip_fetch(identifiant: str) -> dict:
    """Récupère le contenu complet (texte) d'un document BOFiP par son identifiant."""
    params = {"where": f'identifiant_juridique="{identifiant}"', "limit": 1}
    async with httpx.AsyncClient(timeout=45) as c:
        r = await c.get(BASE, params=params)
        r.raise_for_status()
        results = r.json().get("results", [])
    if not results:
        return {"erreur": "Document introuvable", "identifiant": identifiant}
    rec = results[0]
    contenu = rec.get("contenu") or rec.get("contenu_html") or rec.get("content") or ""
    return {
        "titre": rec.get("titre") or "Document BOFiP",
        "identifiant": identifiant,
        "texte": _strip_html(contenu),
        "url": rec.get("permalien") or f"https://bofip.impots.gouv.fr/bofip/{identifiant}",
        "source": "BOFiP",
    }


if __name__ == "__main__":
    mcp.run()
