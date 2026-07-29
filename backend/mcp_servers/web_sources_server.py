"""Serveur MCP — sources web officielles sans API (URSSAF, DGCCRF, ARPP, impots.gouv, service-public).

Outils exposés :
  • list_sources   : liste des pages surveillées (avec le public concerné)
  • fetch_source   : récupère et nettoie le texte d'une page (par clé ou URL)
  • check_updates  : détecte les pages modifiées depuis le dernier passage (hash)

C'est le connecteur "générique" pour tout ce qui n'a pas d'API structurée, dont l'ARPP
(Certificat de l'Influence Responsable) et la DGCCRF (guide de bonnes pratiques).
"""

import asyncio
import hashlib
import json
from pathlib import Path

import httpx
from bs4 import BeautifulSoup
from mcp.server.fastmcp import FastMCP

SOURCES = {
    "urssaf_statut": {
        "url": "https://www.autoentrepreneur.urssaf.fr/portail/accueil/sinformer-sur-le-statut/lessentiel-du-statut.html",
        "source": "URSSAF",
        "concerne": ["tous"],
    },
    "urssaf_seuils_2026": {
        "url": "https://www.autoentrepreneur.urssaf.fr/portail/accueil/sinformer-sur-le-statut/toutes-les-actualites/2026--modification-des-seuils-de.html",
        "source": "URSSAF",
        "concerne": ["tous"],
    },
    "dgccrf_influenceurs": {
        "url": "https://www.economie.gouv.fr/dgccrf/influenceurs-et-createurs-de-contenu",
        "source": "DGCCRF",
        "concerne": ["influenceur"],
    },
    "arpp_influence": {
        "url": "https://www.arpp.org/influenceurs-et-createurs-de-contenu/",
        "source": "ARPP",
        "concerne": ["influenceur"],
    },
    "impots_franchise_tva": {
        "url": "https://www.impots.gouv.fr/professionnel/je-beneficie-dune-franchise-de-tva",
        "source": "impots.gouv.fr",
        "concerne": ["tous"],
    },
    "servicepublic_creation": {
        "url": "https://entreprendre.service-public.fr/vosdroits/F32919",
        "source": "Service-Public",
        "concerne": ["tous"],
    },
}

_STATE = Path("./data/mcp_web_state.json")
mcp = FastMCP("web-sources")


def _extract(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
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


async def _get(url: str, retries: int = 2) -> str:
    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=45, follow_redirects=True) as c:
        for tentative in range(retries + 1):
            try:
                r = await c.get(url, headers=BROWSER_HEADERS)
                r.raise_for_status()
                return _extract(r.text)
            except httpx.TransportError as exc:
                last_exc = exc
                if tentative < retries:
                    await asyncio.sleep(1.5)
    raise last_exc  # type: ignore[misc]


@mcp.tool()
def list_sources() -> dict:
    """Liste les pages officielles surveillées et le public concerné."""
    return {
        "sources": [
            {"cle": k, "url": v["url"], "source": v["source"], "concerne": v["concerne"]}
            for k, v in SOURCES.items()
        ]
    }


@mcp.tool()
async def fetch_source(cle_ou_url: str) -> dict:
    """Récupère le texte nettoyé d'une page officielle.

    Args:
        cle_ou_url: une clé de list_sources (ex "arpp_influence") ou une URL directe.
    """
    if cle_ou_url in SOURCES:
        meta = SOURCES[cle_ou_url]
        url, source, concerne = meta["url"], meta["source"], meta["concerne"]
    else:
        url, source, concerne = cle_ou_url, "Web", ["tous"]
    try:
        texte = await _get(url)
        return {"url": url, "source": source, "concerne": concerne, "texte": texte[:14000]}
    except Exception as exc:  # noqa: BLE001
        return {"url": url, "erreur": str(exc)}


@mcp.tool()
async def check_updates() -> dict:
    """Détecte les pages modifiées depuis le dernier passage (diff de hash)."""
    state = json.loads(_STATE.read_text()) if _STATE.exists() else {}
    nouveautes = []
    for cle, meta in SOURCES.items():
        try:
            texte = await _get(meta["url"])
            h = hashlib.sha256(texte.encode()).hexdigest()
            if state.get(cle) != h:
                state[cle] = h
                nouveautes.append(
                    {"cle": cle, "url": meta["url"], "source": meta["source"],
                     "concerne": meta["concerne"], "texte": texte[:14000]}
                )
        except Exception as exc:  # noqa: BLE001
            nouveautes.append({"cle": cle, "erreur": str(exc)})
    _STATE.parent.mkdir(parents=True, exist_ok=True)
    _STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2))
    return {"nouveautes": nouveautes}


if __name__ == "__main__":
    mcp.run()
