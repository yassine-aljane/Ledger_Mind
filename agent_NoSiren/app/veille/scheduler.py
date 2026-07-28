"""Orchestration de la veille dynamique — VERSION MCP.

Consomme les 3 serveurs MCP (legifrance, bofip, web-sources) au lieu d'appeler des modules
directement. Chaque nouveaute est resumee par Mistral, classee, puis re-ingeree dans le corpus
vectoriel. Le corpus reste vivant.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings
from app.llm.mistral_client import chat
from app.mcp import client as mcp
from app.rag.ingest import ingest_document
from app.roadmap import seuils as S

log = logging.getLogger("veille")

MOTS_CLES = "influence commerciale influenceur micro-entreprise franchise TVA benefices non commerciaux"
_dernier_rapport: dict = {"nouveautes": [], "date": None, "seuils": []}


def _valeur_presente(valeur: int, texte: str) -> bool:
    """Vrai si le nombre `valeur` apparaît dans le texte (tolère espaces/nbsp/points de milliers)."""
    compact = re.sub(r"[\s .]", "", texte or "")
    return re.search(rf"(?<!\d){int(valeur)}(?!\d)", compact) is not None


# (label, valeur stockée, chemin de bloc pour la source) — seuils numériques à contrôler.
def _cibles_seuils() -> list[dict]:
    micro = S.bloc("micro")
    tva = S.bloc("tva_franchise")
    return [
        {"label": "Plafond micro-BNC", "valeur": int(micro["bnc"]["seuil"]), "source": micro["bnc"]["source"]},
        {"label": "Plafond micro-BIC vente", "valeur": int(micro["bic_vente"]["seuil"]), "source": micro["bic_vente"]["source"]},
        {"label": "Franchise TVA services (base)", "valeur": int(tva["services"]["seuil_base"]), "source": tva["services"]["source"]},
        {"label": "Franchise TVA services (majoré)", "valeur": int(tva["services"]["seuil_majore"]), "source": tva["services"]["source"]},
        {"label": "Franchise TVA vente (base)", "valeur": int(tva["vente"]["seuil_base"]), "source": tva["vente"]["source"]},
    ]


async def verifier_seuils() -> list[dict]:
    """Contrôle chaque valeur de seuils.yaml contre sa source officielle via MCP.

    N'ÉCRASE JAMAIS la valeur : signale simplement (log + rapport) « confirme »,
    « ecart_possible » (valeur non retrouvée sur la page) ou « inaccessible ».
    Le rafraîchissement effectif du fichier reste une décision humaine (fichier sourcé/commenté).
    """
    resultats = []
    for cible in _cibles_seuils():
        statut, detail = "inaccessible", ""
        try:
            page = await mcp.call_tool("docs-officiels", "fetch_page", {"cle_ou_url": cible["source"]})
            texte = page.get("texte", "") if isinstance(page, dict) else ""
            if texte:
                statut = "confirme" if _valeur_presente(cible["valeur"], texte) else "ecart_possible"
        except Exception as exc:  # noqa: BLE001
            detail = str(exc)
        if statut != "confirme":
            log.warning("Veille seuils — %s (%s) : %s %s", cible["label"], cible["valeur"], statut, detail)
        resultats.append({**cible, "statut": statut, "detail": detail})
    return resultats


async def _resumer_et_classer(titre: str, texte: str) -> dict:
    systeme = (
        "Tu analyses une publication fiscale/juridique francaise. Reponds en JSON strict : "
        '{"resume":"3 phrases max","concerne":["influenceur"|"freelance"|"tous"],'
        '"impact":"concret pour un createur","pertinent":true|false}. '
        "pertinent=false si le texte ne concerne pas les createurs/independants."
    )
    try:
        out = await chat(
            [
                {"role": "system", "content": systeme},
                {"role": "user", "content": f"Titre : {titre}\n\nTexte : {texte[:6000]}"},
            ],
            temperature=0.1,
            json_mode=True,
        )
        return json.loads(out)
    except Exception as exc:  # noqa: BLE001
        return {"resume": "", "concerne": ["tous"], "impact": "", "pertinent": True, "erreur": str(exc)}


async def _collecter() -> list[dict]:
    """Interroge les 3 serveurs MCP et renvoie une liste unifiee de candidats."""
    items: list[dict] = []

    try:
        res = await mcp.call_tool("legifrance", "legifrance_search", {"mots_cles": MOTS_CLES, "taille": 8})
        for r in res.get("resultats", []):
            items.append({"titre": r["titre"], "url": r["url"], "source": "Legifrance",
                          "texte": r["titre"], "autorite": 1, "concerne": None})
    except Exception as exc:  # noqa: BLE001
        log.warning("MCP legifrance indisponible : %s", exc)

    try:
        res = await mcp.call_tool("bofip", "bofip_search",
                                  {"requete": "avantages en nature revenus non commerciaux", "limite": 4})
        for d in res.get("documents", []):
            items.append({"titre": d["titre"], "url": d["url"], "source": "BOFiP",
                          "texte": d["extrait"], "autorite": 2, "concerne": ["tous"]})
    except Exception as exc:  # noqa: BLE001
        log.warning("MCP bofip indisponible : %s", exc)

    try:
        res = await mcp.call_tool("web-sources", "check_updates", {})
        for n in res.get("nouveautes", []):
            if "erreur" in n:
                continue
            items.append({"titre": f"MAJ {n['source']}", "url": n["url"], "source": n["source"],
                          "texte": n["texte"], "autorite": 2, "concerne": n.get("concerne", ["tous"])})
    except Exception as exc:  # noqa: BLE001
        log.warning("MCP web-sources indisponible : %s", exc)

    # 4) Docs officiels : actualités DGFiP + loi de finances + BOSS (doctrine sociale)
    for cle, autorite in (("impots_actualites", 2), ("loi_finances_2026", 1), ("boss_avantages_nature", 2)):
        try:
            n = await mcp.call_tool("docs-officiels", "fetch_page", {"cle_ou_url": cle})
            if n.get("texte"):
                items.append({"titre": f"{n.get('source','DGFiP')} — {cle}", "url": n["url"],
                              "source": n.get("source", "DGFiP"), "texte": n["texte"],
                              "autorite": autorite, "concerne": n.get("concerne", ["tous"])})
        except Exception as exc:  # noqa: BLE001
            log.warning("MCP docs-officiels (%s) indisponible : %s", cle, exc)

    return items


async def run_veille() -> dict:
    candidats = await _collecter()
    rapport = []
    for c in candidats:
        analyse = await _resumer_et_classer(c["titre"], c["texte"])
        if not analyse.get("pertinent", True):
            continue
        concerne = analyse.get("concerne") or c.get("concerne") or ["tous"]
        ingest_document(
            text=c["texte"],
            source=c["source"],
            titre=c["titre"],
            url=c["url"],
            type_doc="actualite",
            autorite=c.get("autorite", 2),
            concerne=concerne,
        )
        rapport.append({"titre": c["titre"], "source": c["source"], "url": c["url"],
                        "resume": analyse.get("resume", ""), "impact": analyse.get("impact", ""),
                        "concerne": concerne})

    # Contrôle des seuils versionnés (hors ligne, hors du chemin critique de la roadmap).
    seuils_verif = await verifier_seuils()
    ecarts = [s for s in seuils_verif if s["statut"] == "ecart_possible"]

    global _dernier_rapport
    _dernier_rapport = {"nouveautes": rapport, "seuils": seuils_verif,
                        "seuils_ecarts": len(ecarts), "date": datetime.now().isoformat()}
    log.info("Veille MCP terminee : %d nouveaute(s), %d ecart(s) de seuil signale(s)", len(rapport), len(ecarts))
    return _dernier_rapport


def dernier_rapport() -> dict:
    return _dernier_rapport


def start_scheduler() -> AsyncIOScheduler | None:
    if not settings.veille_enabled:
        return None
    sched = AsyncIOScheduler()
    sched.add_job(run_veille, "cron", hour=settings.veille_cron_hour, id="veille_quotidienne")
    sched.start()
    log.info("Scheduler de veille MCP demarre (tous les jours a %sh)", settings.veille_cron_hour)
    return sched
