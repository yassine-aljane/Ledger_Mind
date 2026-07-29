"""Serveur MCP — Légifrance (via l'API PISTE de l'État).

Expose des OUTILS réutilisables par n'importe quel agent :
  • legifrance_search    : recherche de textes récents (JORF/LODA) par mots-clés
  • legifrance_fetch     : récupère un texte par son identifiant
  • code_article         : récupère un article d'un code (CGI, Code de la consommation, etc.)

Transport stdio (le client MCP lance ce fichier en sous-processus).
Identifiants PISTE via variables d'environnement PISTE_CLIENT_ID / PISTE_CLIENT_SECRET.
Sans identifiants, les outils renvoient un message explicite plutôt que d'échouer.
"""
from __future__ import annotations

import os
import re

import httpx
from mcp.server.fastmcp import FastMCP

# PISTE a migré de *.aife.economie.gouv.fr (décommissionné) vers *.piste.gouv.fr.
OAUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token"
API_BASE = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app"

# Codes utiles pour le secteur créateurs/influenceurs
CODES = {
    "CGI": "Code général des impôts",
    "CCONSO": "Code de la consommation",
    "CSS": "Code de la sécurité sociale",
}

mcp = FastMCP("legifrance")


def _creds() -> tuple[str, str] | None:
    cid = os.getenv("PISTE_CLIENT_ID", "")
    secret = os.getenv("PISTE_CLIENT_SECRET", "")
    return (cid, secret) if cid and secret else None


async def _token(cid: str, secret: str) -> str:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            OAUTH_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": cid,
                "client_secret": secret,
                "scope": "openid",
            },
        )
        r.raise_for_status()
        return r.json()["access_token"]


@mcp.tool()
async def legifrance_search(mots_cles: str, taille: int = 8) -> dict:
    """Recherche des textes officiels récents (JORF) contenant les mots-clés.

    Args:
        mots_cles: termes à rechercher (ex "influence commerciale micro-entreprise").
        taille: nombre max de résultats.
    Returns: {"resultats": [{"titre","id","url"}], "source": "Légifrance"}
    """
    creds = _creds()
    if not creds:
        return {"resultats": [], "indisponible": "Identifiants PISTE absents", "source": "Légifrance"}

    token = await _token(*creds)
    payload = {
        "recherche": {
            "champs": [
                {
                    "typeChamp": "ALL",
                    "criteres": [
                        {"typeRecherche": "UN_DES_MOTS", "valeur": mots_cles, "operateur": "ET"}
                    ],
                    "operateur": "ET",
                }
            ],
            "filtres": [],
            "pageNumber": 1,
            "pageSize": taille,
            "sort": "PUBLICATION_DATE_DESC",
            "typePagination": "DEFAUT",
        },
        "fond": "JORF",
    }
    async with httpx.AsyncClient(timeout=45) as c:
        r = await c.post(
            f"{API_BASE}/search",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
        )
        r.raise_for_status()
        data = r.json()

    resultats = []
    for item in data.get("results", []):
        titres = item.get("titles", [])
        titre = titres[0].get("title") if titres else "Sans titre"
        cid = titres[0].get("cid") if titres else None
        resultats.append(
            {
                "titre": titre,
                "id": cid,
                "url": f"https://www.legifrance.gouv.fr/jorf/id/{cid}" if cid else "",
            }
        )
    return {"resultats": resultats, "source": "Légifrance"}


def _strip_html(html: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", " ", html or "").split())


def _find_legiarti(data: dict, num: str) -> str | None:
    """Trouve l'identifiant LEGIARTI de l'article dont le numéro == num (résultat fond CODE_DATE)."""
    def walk(sections):
        for s in sections or []:
            for ex in s.get("extracts", []) or []:
                if str(ex.get("title")).strip() == num and str(ex.get("id", "")).startswith("LEGIARTI"):
                    return ex["id"]
            found = walk(s.get("sections"))
            if found:
                return found
        return None

    for res in data.get("results", []):
        got = walk(res.get("sections"))
        if got:
            return got
    return None


@mcp.tool()
async def code_article(code: str, article: str) -> dict:
    """Récupère le texte d'un article d'un code juridique.

    Args:
        code: sigle parmi CGI, CCONSO, CSS.
        article: numéro d'article (ex "92", "293 B", "L121-1").

    Note : l'API DILA n'a pas d'accès direct par n° d'article ; on recherche l'article dans le
    code (fond CODE_DATE) pour obtenir son identifiant LEGIARTI, puis on récupère son texte.
    """
    if code not in CODES:
        return {"erreur": f"Code inconnu. Choisir parmi {list(CODES)}"}
    creds = _creds()
    if not creds:
        return {"indisponible": "Identifiants PISTE absents", "code": CODES[code], "article": article}

    token = await _token(*creds)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {
        "recherche": {
            "champs": [{"typeChamp": "NUM_ARTICLE", "criteres": [
                {"typeRecherche": "EXACTE", "valeur": article, "operateur": "ET"}], "operateur": "ET"}],
            "filtres": [{"facette": "NOM_CODE", "valeurs": [CODES[code]]}],
            "pageNumber": 1, "pageSize": 5, "operateur": "ET",
            "sort": "PERTINENCE", "typePagination": "ARTICLE",
        },
        "fond": "CODE_DATE",
    }
    async with httpx.AsyncClient(timeout=45) as c:
        rs = await c.post(f"{API_BASE}/search", headers=headers, json=payload)
        if rs.status_code != 200:
            return {"erreur": f"HTTP {rs.status_code} (recherche)", "code": CODES[code], "article": article}
        legiarti = _find_legiarti(rs.json(), article)
        if not legiarti:
            return {"erreur": "Article introuvable", "code": CODES[code], "article": article}
        ra = await c.post(f"{API_BASE}/consult/getArticle", headers=headers, json={"id": legiarti})
        if ra.status_code != 200:
            return {"erreur": f"HTTP {ra.status_code} (getArticle)", "code": CODES[code], "article": article}
        contenu = (ra.json().get("article") or {}).get("texte", "")

    return {
        "code": CODES[code],
        "article": article,
        "texte": _strip_html(contenu),
        "url": f"https://www.legifrance.gouv.fr/codes/article_lc/{legiarti}",
        "source": "Légifrance",
    }


@mcp.tool()
async def legifrance_fetch(cid: str) -> dict:
    """Récupère le texte complet d'un texte JORF/loi par son identifiant (ex "JORFTEXT000047663185").

    Args:
        cid: identifiant JORF du texte (loi, décret, ordonnance).
    """
    creds = _creds()
    if not creds:
        return {"indisponible": "Identifiants PISTE absents", "cid": cid}

    token = await _token(*creds)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=45) as c:
        r = await c.post(f"{API_BASE}/consult/jorf", headers=headers, json={"textCid": cid})
        if r.status_code != 200:
            return {"erreur": f"HTTP {r.status_code}", "cid": cid}
        data = r.json()

    morceaux: list[str] = []

    def collect(sections):
        for s in sections or []:
            for a in s.get("articles", []) or []:
                txt = _strip_html(a.get("content") or a.get("texte") or "")
                if txt:
                    num = a.get("num")
                    morceaux.append(f"Article {num} : {txt}" if num else txt)
            collect(s.get("sections"))

    collect(data.get("sections"))
    return {
        "titre": data.get("title") or cid,
        "texte": "\n\n".join(morceaux),
        "url": f"https://www.legifrance.gouv.fr/jorf/id/{cid}",
        "source": "Légifrance",
    }


if __name__ == "__main__":
    mcp.run()
