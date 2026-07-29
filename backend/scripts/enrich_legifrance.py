"""Ingère des articles de codes juridiques (Légifrance via PISTE) dans le corpus fiscal.

Droit primaire (autorité 1), qui prime sur la doctrine BOFiP lors de la recherche : quand
l'agent pédagogique cite un plafond ou une définition, il peut remonter au texte de loi.

Usage (depuis la racine du dépôt, venv actif) :

    python -m backend.scripts.enrich_legifrance

Prérequis : `PISTE_CLIENT_ID` / `PISTE_CLIENT_SECRET` dans `backend/.env` — ils sont propagés
aux serveurs MCP par `app/mcp/client.py`. Sans ces clés, le script s'arrête proprement en le
signalant : le corpus reste utilisable avec BOFiP et les documents officiels seuls.
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

# (code, article, public concerné) — droit primaire pertinent pour créateurs et indépendants.
ARTICLES = [
    ("CGI", "92", ["tous"]),                # définition des bénéfices non commerciaux (BNC)
    ("CGI", "93", ["tous"]),                # détermination du bénéfice imposable BNC
    ("CGI", "293 B", ["tous"]),             # franchise en base de TVA (seuils)
    ("CGI", "50-0", ["tous"]),              # régime micro-BIC
    ("CCONSO", "L121-1", ["influenceur"]),  # pratiques commerciales trompeuses
    ("CCONSO", "L121-4", ["influenceur"]),  # liste des pratiques commerciales trompeuses
]

# Textes JORF complets : (cid, titre court, public concerné).
TEXTES_JORF = [
    ("JORFTEXT000047663185",
     "Loi n° 2023-451 (encadrement de l'influence commerciale)", ["influenceur"]),
]


async def enrich() -> int:
    total = 0

    print("=== Légifrance — articles de codes (droit primaire) ===")
    for code, article, concerne in ARTICLES:
        try:
            res = await call_tool("legifrance", "code_article", {"code": code, "article": article})
            if not isinstance(res, dict) or res.get("indisponible"):
                detail = res.get("indisponible") if isinstance(res, dict) else res
                print(f"  [!!] {code} {article} — indisponible (clés PISTE ?) : {detail}")
                continue
            texte = res.get("texte") or ""
            if res.get("erreur") or len(texte) < 80:
                print(f"  [!!] {code} {article} — {res.get('erreur') or 'texte trop court'}")
                continue
            nb = await ingest_document(
                text=texte, source="Légifrance",
                titre=f"{res.get('code', code)} — article {article}",
                url=res.get("url", ""), type_doc="loi", autorite=1, concerne=concerne,
            )
            total += nb
            print(f"  [ok] {code} {article} — {nb} chunks")
        except Exception as exc:  # noqa: BLE001
            print(f"  [!!] {code} {article} — {type(exc).__name__}: {exc}")

    print("\n=== Légifrance — textes JORF complets ===")
    for cid, titre, concerne in TEXTES_JORF:
        try:
            res = await call_tool("legifrance", "legifrance_fetch", {"cid": cid})
            if not isinstance(res, dict) or res.get("indisponible"):
                detail = res.get("indisponible") if isinstance(res, dict) else res
                print(f"  [!!] {titre} — indisponible : {detail}")
                continue
            texte = res.get("texte") or ""
            if res.get("erreur") or len(texte) < 80:
                print(f"  [!!] {titre} — {res.get('erreur') or 'texte trop court'}")
                continue
            nb = await ingest_document(
                text=texte, source="Légifrance", titre=res.get("titre", titre),
                url=res.get("url", ""), type_doc="loi", autorite=1, concerne=concerne,
            )
            total += nb
            print(f"  [ok] {titre} — {nb} chunks")
        except Exception as exc:  # noqa: BLE001
            print(f"  [!!] {titre} — {type(exc).__name__}: {exc}")

    print(f"\nCorpus enrichi via Légifrance : {total} chunks ingérés.")
    return total


if __name__ == "__main__":
    asyncio.run(enrich())
