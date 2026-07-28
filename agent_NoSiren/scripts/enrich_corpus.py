"""Enrichit le corpus RAG via les serveurs MCP (voie fiable : API structurées, pas de scraping).

Sources :
  • BOFiP           : doctrine fiscale opposable (bofip_search + bofip_fetch pour le texte complet)
  • docs-officiels  : fetch_page sur des fiches Service-Public/DGFiP + boss_fetch (doctrine sociale)

Usage :  python -m scripts.enrich_corpus   (backend arrêté ou non, peu importe : écrit dans ChromaDB)
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.mcp.client import call_tool  # noqa: E402
from app.rag.ingest import ingest_document  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

# Requêtes BOFiP (doctrine fiscale) — couvrent la question des avantages en nature des créateurs.
BOFIP_QUERIES = [
    "avantages en nature",
    "bénéfices non commerciaux BNC",
    "franchise en base de TVA",
    "revenus des influenceurs création de contenu",
]

# Clés du catalogue docs-officiels OU URL directe *.gouv.fr à récupérer via fetch_page.
DOCS_KEYS = {
    "impots_franchise_tva": "Franchise en base de TVA (Service-Public)",
    "impots_pro_bnc": "Régime fiscal de la micro-entreprise (Service-Public)",
    "loi_finances_2026": "Loi de finances 2026",
    # 6.2 — Déclaration : 2042-C-PRO (micro BNC/BIC) + circuit URSSAF distinct qui se cumule.
    "https://www.impots.gouv.fr/particulier/questions/comment-declarer-les-revenus-provenant-de-mon-activite-dauto-entrepreneur":
        "Déclarer ses revenus de micro-entrepreneur : 2042-C-PRO et déclaration URSSAF distincte",
    # 6.1/6.3 — Activité d'influence : BNC vs BIC selon la nature, avantages en nature imposables
    # et cotisables dès le 1er euro à leur valeur réelle.
    "https://www.economie.gouv.fr/suis-je-influenceur-demarches":
        "Activité d'influence commerciale : démarches, BNC/BIC selon la nature, avantages en nature",
}

# Documents BOFiP curés (récupérés par identifiant, plus fiables que la recherche floue).
# BOI-BNC-CHAMP-10-10-20-40 traite explicitement des cadeaux/avantages reçus, imposables à
# leur valeur vénale : c'est LA doctrine pour "produits gratuits reçus par un créateur".
BOFIP_IDENTIFIANTS = {
    "BOI-BNC-CHAMP-10-10-20-40": "BNC - Revenus imposables - Généralités (avantages/cadeaux, valeur vénale)",
    "BOI-BNC-CHAMP-10-10-20-20": "BNC - Revenus imposables - Droits d'auteur",
    "BOI-BNC-CHAMP-10-30-30": "BNC - Revenus imposables - Professions artistiques",
}


async def _ingest_bofip(query: str) -> int:
    """Recherche BOFiP puis ingère le texte complet de chaque document (repli sur l'extrait)."""
    total = 0
    res = await call_tool("bofip", "bofip_search", {"requete": query, "limite": 4})
    docs = res.get("documents", []) if isinstance(res, dict) else []
    for d in docs:
        ident = d.get("identifiant") or ""
        titre = d.get("titre") or "Document BOFiP"
        url = d.get("url") or "https://bofip.impots.gouv.fr"
        texte = ""
        if ident:
            try:
                full = await call_tool("bofip", "bofip_fetch", {"identifiant": ident})
                if isinstance(full, dict) and full.get("texte"):
                    texte = full["texte"]
                    url = full.get("url", url)
            except Exception:  # noqa: BLE001
                pass
        if len(texte) < 80:
            texte = d.get("extrait") or ""
        if len(texte) < 80:
            continue
        try:
            total += ingest_document(
                text=texte, source="BOFiP", titre=titre, url=url,
                type_doc="doctrine", autorite=2, concerne=["tous"],
            )
        except Exception as exc:  # noqa: BLE001
            print(f"    ! ingestion BOFiP échouée ({titre[:40]}) : {exc}")
    return total


async def _ingest_page(cle: str, titre: str) -> int:
    res = await call_tool("docs-officiels", "fetch_page", {"cle_ou_url": cle})
    if not isinstance(res, dict) or res.get("erreur") or not res.get("texte"):
        detail = res.get("erreur") if isinstance(res, dict) else "réponse vide"
        raise RuntimeError(detail or "réponse vide")
    return ingest_document(
        text=res["texte"], source=res.get("source", "gouv.fr"), titre=titre,
        url=res.get("url", cle), type_doc="doctrine", autorite=2,
        concerne=res.get("concerne", ["tous"]),
    )


async def main() -> None:
    total = 0

    print("=== BOFiP (doctrine fiscale) ===")
    for q in BOFIP_QUERIES:
        try:
            n = await _ingest_bofip(q)
            total += n
            print(f"  [OK] bofip_search '{q}' — {n} chunks")
        except Exception as exc:  # noqa: BLE001
            print(f"  [X]  bofip_search '{q}' — {type(exc).__name__}: {exc}")

    print("\n=== BOFiP — documents curés (par identifiant) ===")
    for ident, label in BOFIP_IDENTIFIANTS.items():
        try:
            res = await call_tool("bofip", "bofip_fetch", {"identifiant": ident})
            if isinstance(res, dict) and res.get("texte") and len(res["texte"]) > 80:
                n = ingest_document(
                    text=res["texte"], source="BOFiP", titre=res.get("titre", label),
                    url=res.get("url", ""), type_doc="doctrine", autorite=2,
                    concerne=["influenceur"],
                )
                total += n
                print(f"  [OK] {ident} — {n} chunks")
            else:
                print(f"  [X]  {ident} — vide/erreur")
        except Exception as exc:  # noqa: BLE001
            print(f"  [X]  {ident} — {type(exc).__name__}: {exc}")

    print("\n=== docs-officiels (fetch_page) ===")
    for cle, titre in DOCS_KEYS.items():
        try:
            n = await _ingest_page(cle, titre)
            total += n
            print(f"  [OK] {cle} — {n} chunks")
        except Exception as exc:  # noqa: BLE001
            print(f"  [X]  {cle} — {type(exc).__name__}: {exc}")

    print("\n=== BOSS (doctrine sociale — avantages en nature) ===")
    try:
        res = await call_tool("docs-officiels", "boss_fetch", {"cle_ou_url": "boss_avantages_nature"})
        if isinstance(res, dict) and res.get("texte"):
            n = ingest_document(
                text=res["texte"], source="BOSS", titre="Avantages en nature (BOSS)",
                url=res.get("url", "https://boss.gouv.fr"), type_doc="doctrine",
                autorite=2, concerne=["tous"],
            )
            total += n
            print(f"  [OK] boss_fetch — {n} chunks")
        else:
            detail = res.get("erreur") if isinstance(res, dict) else res
            print(f"  [X]  boss_fetch — réponse vide/erreur : {detail}")
    except Exception as exc:  # noqa: BLE001
        print(f"  [X]  boss_fetch — {type(exc).__name__}: {exc}")

    print(f"\nCorpus enrichi : {total} chunks ingérés (via MCP).")


if __name__ == "__main__":
    asyncio.run(main())
