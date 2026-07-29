"""Serveur MCP — Documents officiels (DGFiP / impots.gouv, Service-Public API, BOSS, PDF).

Regroupe les sources documentaires officielles hétérogènes :
  • sp_search        : API officielle Service-Public.fr (fiches pratiques, via data.gouv/DILA)
  • fetch_page       : récupère+nettoie une page HTML officielle (impots.gouv, actualités DGFiP, LF, FAQ)
  • fetch_pdf        : télécharge et extrait le texte d'un PDF officiel (notices de formulaires, guides)
  • boss_fetch       : récupère une page du Bulletin Officiel de la Sécurité Sociale (avantages en nature)
  • catalogue        : liste des points d'entrée officiels prêts à l'emploi (avec le public concerné)

Fiabilité : Service-Public passe par l'API DILA (structurée). Le reste est du fetch officiel
gouvernemental (domaines *.gouv.fr) avec extraction robuste ; les PDF sont extraits via pdfminer.
"""

import asyncio
import io
import re

import httpx
from bs4 import BeautifulSoup
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("docs-officiels")

# API Service-Public.fr (jeu de données DILA sur data.gouv, moteur Opendatasoft)
SP_API = "https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records"

# Points d'entrée officiels prêts à l'emploi
CATALOGUE = {
    "impots_pro_bnc": {
        "url": "https://entreprendre.service-public.gouv.fr/vosdroits/F23267",
        "type": "guide", "source": "Service-Public", "concerne": ["tous"],
    },
    "impots_franchise_tva": {
        "url": "https://entreprendre.service-public.gouv.fr/vosdroits/F21746",
        "type": "guide", "source": "Service-Public", "concerne": ["tous"],
    },
    "impots_actualites": {
        "url": "https://www.impots.gouv.fr/actualites",
        "type": "actualite", "source": "DGFiP", "concerne": ["tous"],
    },
    "loi_finances_2026": {
        "url": "https://www.economie.gouv.fr/loi-finances-2026",
        "type": "loi_finances", "source": "DGFiP", "concerne": ["tous"],
    },
    "notice_2042_c_pro": {
        # Notice officielle du formulaire de déclaration des revenus pro (PDF)
        "url": "https://www.impots.gouv.fr/formulaire/2042-c-pro/notice",
        "type": "notice_pdf", "source": "DGFiP", "concerne": ["tous"],
    },
    "boss_avantages_nature": {
        "url": "https://boss.gouv.fr/portail/accueil/avantages-en-nature-et-frais-profession.html",
        "type": "doctrine_sociale", "source": "BOSS", "concerne": ["tous"],
    },
}


def _clean(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for t in soup(["script", "style", "nav", "footer", "header"]):
        t.decompose()
    main = soup.find("main") or soup.body or soup
    return " ".join(main.get_text(" ", strip=True).split())


BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9",
    "Accept": "text/html,application/xhtml+xml",
}


async def _get(url: str, timeout: int = 45, retries: int = 2) -> httpx.Response:
    """GET navigateur + petit retry sur erreurs réseau transitoires."""
    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as c:
        for tentative in range(retries + 1):
            try:
                r = await c.get(url, headers=BROWSER_HEADERS)
                r.raise_for_status()
                return r
            except httpx.TransportError as exc:
                last_exc = exc
                if tentative < retries:
                    await asyncio.sleep(1.5)
    raise last_exc  # type: ignore[misc]


@mcp.tool()
def catalogue() -> dict:
    """Liste les points d'entrée officiels prêts à l'emploi (clé, url, type, source, public)."""
    return {"entrees": [{"cle": k, **v} for k, v in CATALOGUE.items()]}


@mcp.tool()
async def fetch_page(cle_ou_url: str) -> dict:
    """Récupère et nettoie le texte d'une page officielle (HTML).

    Args:
        cle_ou_url: une clé du catalogue ou une URL *.gouv.fr directe.
    """
    entry = CATALOGUE.get(cle_ou_url)
    url = entry["url"] if entry else cle_ou_url
    source = entry["source"] if entry else "gouv.fr"
    concerne = entry["concerne"] if entry else ["tous"]
    r = await _get(url)
    return {"url": url, "source": source, "concerne": concerne, "texte": _clean(r.text)[:14000]}


@mcp.tool()
async def fetch_pdf(url: str, max_pages: int = 12) -> dict:
    """Télécharge un PDF officiel (notice de formulaire, guide) et en extrait le texte.

    Args:
        url: URL directe d'un PDF officiel (ex notice 2042-C-PRO).
        max_pages: limite de pages à extraire.
    """
    from pdfminer.high_level import extract_text

    r = await _get(url, timeout=60)
    contenu = r.content
    if b"%PDF" not in contenu[:1024]:
        # Certaines URL /notice renvoient une page HTML pointant vers le PDF ; on tente d'y voir clair.
        return {"url": url, "avertissement": "La ressource ne semble pas être un PDF direct.",
                "apercu_html": _clean(contenu.decode("utf-8", "ignore"))[:2000]}
    texte = extract_text(io.BytesIO(contenu), maxpages=max_pages) or ""
    return {"url": url, "source": "DGFiP", "texte": re.sub(r"\s+", " ", texte)[:16000]}


@mcp.tool()
async def boss_fetch(cle_ou_url: str = "boss_avantages_nature") -> dict:
    """Récupère une page du Bulletin Officiel de la Sécurité Sociale (doctrine sociale opposable)."""
    return await fetch_page(cle_ou_url)


@mcp.tool()
async def sp_search(requete: str, limite: int = 5) -> dict:
    """Recherche dans l'annuaire/fiches Service-Public.fr via l'API DILA officielle.

    Note : l'API annuaire renvoie surtout des organismes ; pour les fiches pratiques de contenu,
    utiliser fetch_page sur une URL entreprendre.service-public.fr précise.
    """
    params = {"where": f'search(*, "{requete}")', "limit": min(limite, 20)}
    async with httpx.AsyncClient(timeout=45) as c:
        r = await c.get(SP_API, params=params)
        if r.status_code != 200:
            r = await c.get(SP_API, params={"q": requete, "limit": min(limite, 20)})
        r.raise_for_status()
        data = r.json()
    return {
        "resultats": [
            {"nom": rec.get("nom"), "type": rec.get("pivot_local") or rec.get("categorie"),
             "url": rec.get("url_service_public") or rec.get("site_internet")}
            for rec in data.get("results", [])
        ],
        "source": "Service-Public.fr (DILA)",
    }


if __name__ == "__main__":
    mcp.run()
