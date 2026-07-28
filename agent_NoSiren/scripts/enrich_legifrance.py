"""Ingère des articles de codes juridiques (Légifrance via PISTE) dans le corpus RAG.

Droit primaire (autorité 1) complétant la doctrine BOFiP. Nécessite PISTE_CLIENT_ID/SECRET
dans .env (propagés aux serveurs MCP par app/mcp/client.py).

Usage :  python -m scripts.enrich_legifrance
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

# (code, article, public concerné) — droit primaire pertinent pour créateurs/influenceurs.
ARTICLES = [
    ("CGI", "92", ["tous"]),                # définition des bénéfices non commerciaux (BNC)
    ("CGI", "93", ["tous"]),                # détermination du bénéfice imposable BNC
    ("CGI", "293 B", ["tous"]),             # franchise en base de TVA (seuils)
    ("CGI", "50-0", ["tous"]),              # régime micro-BIC
    ("CCONSO", "L121-1", ["influenceur"]),  # pratiques commerciales trompeuses
    ("CCONSO", "L121-4", ["influenceur"]),  # liste des pratiques commerciales trompeuses
]

# Textes JORF complets (loi/décret/ordonnance) : (cid, titre court, public concerné).
TEXTES_JORF = [
    ("JORFTEXT000047663185", "Loi n° 2023-451 (encadrement de l'influence commerciale)", ["influenceur"]),
]


async def main() -> None:
    total = 0
    print("=== Légifrance — articles de codes (droit primaire) ===")
    for code, article, concerne in ARTICLES:
        try:
            res = await call_tool("legifrance", "code_article", {"code": code, "article": article})
            if not isinstance(res, dict) or res.get("indisponible"):
                detail = res.get("indisponible") if isinstance(res, dict) else res
                print(f"  [X]  {code} {article} — indisponible (clés PISTE ?) : {detail}")
                continue
            texte = res.get("texte") or ""
            if res.get("erreur") or len(texte) < 80:
                print(f"  [X]  {code} {article} — {res.get('erreur') or 'texte trop court'}")
                continue
            n = ingest_document(
                text=texte, source="Légifrance",
                titre=f"{res.get('code', code)} — article {article}",
                url=res.get("url", ""), type_doc="loi", autorite=1, concerne=concerne,
            )
            total += n
            print(f"  [OK] {code} {article} — {n} chunks")
        except Exception as exc:  # noqa: BLE001
            print(f"  [X]  {code} {article} — {type(exc).__name__}: {exc}")

    print("\n=== Légifrance — textes JORF complets ===")
    for cid, titre, concerne in TEXTES_JORF:
        try:
            res = await call_tool("legifrance", "legifrance_fetch", {"cid": cid})
            if not isinstance(res, dict) or res.get("indisponible"):
                detail = res.get("indisponible") if isinstance(res, dict) else res
                print(f"  [X]  {titre} — indisponible : {detail}")
                continue
            texte = res.get("texte") or ""
            if res.get("erreur") or len(texte) < 80:
                print(f"  [X]  {titre} — {res.get('erreur') or 'texte trop court'}")
                continue
            n = ingest_document(
                text=texte, source="Légifrance", titre=res.get("titre", titre),
                url=res.get("url", ""), type_doc="loi", autorite=1, concerne=concerne,
            )
            total += n
            print(f"  [OK] {titre} — {n} chunks")
        except Exception as exc:  # noqa: BLE001
            print(f"  [X]  {titre} — {type(exc).__name__}: {exc}")

    print(f"\nCorpus enrichi (Légifrance) : {total} chunks ingérés.")


if __name__ == "__main__":
    asyncio.run(main())
