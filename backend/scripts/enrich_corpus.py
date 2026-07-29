"""Enrichit le corpus fiscal via les serveurs MCP — API structurées, pas de scraping.

Complète `seed_corpus.py` (qui télécharge des pages web) par la voie fiable : la doctrine est
récupérée telle que l'administration la publie, avec son identifiant et son URL canonique.

Sources :
  • BOFiP          : doctrine fiscale opposable (`bofip_search` puis `bofip_fetch` pour le
                     texte complet, plus quelques documents curés par identifiant) ;
  • docs-officiels : fiches Service-Public / DGFiP via `fetch_page`, et doctrine sociale
                     (avantages en nature) via `boss_fetch`.

Usage (depuis la racine du dépôt, venv actif) :

    python -m backend.scripts.enrich_corpus

Prérequis : `GEMINI_API_KEY` (embeddings) et `MONGO_URI` (stockage des vecteurs). Aucune clé
n'est nécessaire pour BOFiP et les docs officiels — seul Légifrance demande PISTE
(voir `enrich_legifrance.py`).

Chaque source est indépendante : celle qui échoue est signalée, les autres sont ingérées.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.mcp.client import call_tool  # noqa: E402
from app.rag.ingest import ingest_document  # noqa: E402

# Évite UnicodeEncodeError sur les marqueurs quand la console Windows est en cp1252.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

# Recherches BOFiP — couvrent les questions récurrentes des créateurs et indépendants.
BOFIP_QUERIES = [
    "avantages en nature",
    "bénéfices non commerciaux BNC",
    "franchise en base de TVA",
    "revenus des influenceurs création de contenu",
]

# Documents BOFiP curés, récupérés par identifiant : plus fiables que la recherche floue.
# BOI-BNC-CHAMP-10-10-20-40 traite explicitement des cadeaux et avantages reçus, imposables à
# leur valeur vénale — c'est LA doctrine pour « produits gratuits reçus par un créateur ».
BOFIP_IDENTIFIANTS = {
    "BOI-BNC-CHAMP-10-10-20-40": "BNC — revenus imposables (avantages et cadeaux, valeur vénale)",
    "BOI-BNC-CHAMP-10-10-20-20": "BNC — revenus imposables (droits d'auteur)",
    "BOI-BNC-CHAMP-10-30-30": "BNC — revenus imposables (professions artistiques)",
}

# Clés du catalogue docs-officiels, ou URL *.gouv.fr directe, à récupérer via `fetch_page`.
DOCS_KEYS = {
    "impots_franchise_tva": "Franchise en base de TVA (Service-Public)",
    "impots_pro_bnc": "Régime fiscal de la micro-entreprise (Service-Public)",
    "loi_finances_2026": "Loi de finances 2026",
    # Déclaration : 2042-C-PRO (micro BNC/BIC) et circuit URSSAF distinct qui se cumule.
    "https://www.impots.gouv.fr/particulier/questions/comment-declarer-les-revenus-provenant-de-mon-activite-dauto-entrepreneur":
        "Déclarer ses revenus de micro-entrepreneur : 2042-C-PRO et déclaration URSSAF distincte",
    # Activité d'influence : BNC ou BIC selon la nature, avantages en nature imposables et
    # cotisables dès le premier euro, à leur valeur réelle.
    "https://www.economie.gouv.fr/suis-je-influenceur-demarches":
        "Activité d'influence commerciale : démarches, BNC/BIC, avantages en nature",
}


async def _ingest_bofip(requete: str) -> int:
    """Recherche BOFiP puis ingère le texte complet de chaque document (repli sur l'extrait)."""
    total = 0
    res = await call_tool("bofip", "bofip_search", {"requete": requete, "limite": 4})
    documents = res.get("documents", []) if isinstance(res, dict) else []

    for doc in documents:
        identifiant = doc.get("identifiant") or ""
        titre = doc.get("titre") or "Document BOFiP"
        url = doc.get("url") or "https://bofip.impots.gouv.fr"
        texte = ""

        if identifiant:
            try:
                complet = await call_tool("bofip", "bofip_fetch", {"identifiant": identifiant})
                if isinstance(complet, dict) and complet.get("texte"):
                    texte = complet["texte"]
                    url = complet.get("url", url)
            except Exception:  # noqa: BLE001 — on retombe sur l'extrait de la recherche
                pass

        if len(texte) < 80:
            texte = doc.get("extrait") or ""
        if len(texte) < 80:
            continue

        try:
            total += await ingest_document(
                text=texte, source="BOFiP", titre=titre, url=url,
                type_doc="doctrine", autorite=2, concerne=["tous"],
            )
        except Exception as exc:  # noqa: BLE001
            print(f"    [!!] ingestion BOFiP échouée ({titre[:40]}) : {exc}")

    return total


async def _ingest_page(cle: str, titre: str) -> int:
    res = await call_tool("docs-officiels", "fetch_page", {"cle_ou_url": cle})
    if not isinstance(res, dict) or res.get("erreur") or not res.get("texte"):
        detail = res.get("erreur") if isinstance(res, dict) else "réponse vide"
        raise RuntimeError(detail or "réponse vide")
    return await ingest_document(
        text=res["texte"], source=res.get("source", "gouv.fr"), titre=titre,
        url=res.get("url", cle), type_doc="doctrine", autorite=2,
        concerne=res.get("concerne", ["tous"]),
    )


async def enrich() -> int:
    total = 0

    print("=== BOFiP — recherche de doctrine ===")
    for requete in BOFIP_QUERIES:
        try:
            nb = await _ingest_bofip(requete)
            total += nb
            print(f"  [ok] bofip_search « {requete} » — {nb} chunks")
        except Exception as exc:  # noqa: BLE001
            print(f"  [!!] bofip_search « {requete} » — {type(exc).__name__}: {exc}")

    print("\n=== BOFiP — documents curés (par identifiant) ===")
    for identifiant, libelle in BOFIP_IDENTIFIANTS.items():
        try:
            res = await call_tool("bofip", "bofip_fetch", {"identifiant": identifiant})
            if isinstance(res, dict) and len(res.get("texte") or "") > 80:
                nb = await ingest_document(
                    text=res["texte"], source="BOFiP", titre=res.get("titre", libelle),
                    url=res.get("url", ""), type_doc="doctrine", autorite=2,
                    concerne=["influenceur"],
                )
                total += nb
                print(f"  [ok] {identifiant} — {nb} chunks")
            else:
                print(f"  [!!] {identifiant} — réponse vide")
        except Exception as exc:  # noqa: BLE001
            print(f"  [!!] {identifiant} — {type(exc).__name__}: {exc}")

    print("\n=== Documents officiels (fetch_page) ===")
    for cle, titre in DOCS_KEYS.items():
        try:
            nb = await _ingest_page(cle, titre)
            total += nb
            print(f"  [ok] {cle[:60]} — {nb} chunks")
        except Exception as exc:  # noqa: BLE001
            print(f"  [!!] {cle[:60]} — {type(exc).__name__}: {exc}")

    print("\n=== BOSS — doctrine sociale (avantages en nature) ===")
    try:
        res = await call_tool("docs-officiels", "boss_fetch",
                              {"cle_ou_url": "boss_avantages_nature"})
        if isinstance(res, dict) and res.get("texte"):
            nb = await ingest_document(
                text=res["texte"], source="BOSS", titre="Avantages en nature (BOSS)",
                url=res.get("url", "https://boss.gouv.fr"), type_doc="doctrine",
                autorite=2, concerne=["tous"],
            )
            total += nb
            print(f"  [ok] boss_fetch — {nb} chunks")
        else:
            detail = res.get("erreur") if isinstance(res, dict) else res
            print(f"  [!!] boss_fetch — réponse vide : {detail}")
    except Exception as exc:  # noqa: BLE001
        print(f"  [!!] boss_fetch — {type(exc).__name__}: {exc}")

    print(f"\nCorpus enrichi via MCP : {total} chunks ingérés.")
    return total


if __name__ == "__main__":
    asyncio.run(enrich())
