"""Veille réglementaire — le corpus reste vivant.

Consomme les serveurs MCP (Légifrance/PISTE, BOFiP, sources web, docs officiels), fait résumer
et classer chaque nouveauté par le LLM, puis la ré-ingère dans le corpus.

Contrôle des seuils : chaque valeur de `data/seuils.yaml` est confrontée à sa source officielle.
La valeur n'est JAMAIS écrasée automatiquement — un écart est signalé, et sa correction reste une
décision humaine (le fichier est sourcé et commenté).

La veille est désactivée par défaut (`VEILLE_ENABLED=false`) : elle sort du réseau et n'est pas
sur le chemin critique de l'application.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime

from app.config import settings
from app.llm import chat_json_with_system
from app.rag.ingest import ingest_document

logger = logging.getLogger(__name__)

MOTS_CLES = ("influence commerciale influenceur micro-entreprise franchise TVA "
             "benefices non commerciaux")

_dernier_rapport: dict = {
    "nouveautes": [], "date": None, "seuils": [], "seuils_ecarts": 0,
    "echeancier": [], "echeancier_ecarts": 0,
}


def _valeur_presente(valeur: int, texte: str) -> bool:
    """Vrai si le nombre apparaît dans le texte (tolère espaces, insécables, points de milliers)."""
    compact = re.sub(r"[\s .]", "", texte or "")
    return re.search(rf"(?<!\d){int(valeur)}(?!\d)", compact) is not None


def _motif_present(motif: str, texte: str) -> bool:
    """Vrai si le motif (ex. "15 décembre") apparaît dans le texte.

    Les espaces sont entièrement retirés avant comparaison (pas seulement normalisés) : certaines
    extractions HTML/PDF insèrent une espace parasite dans les ordinaux ("1 er mai" au lieu de
    "1er mai"), ce qui ferait sinon remonter un faux "écart" sur un texte pourtant inchangé.
    """
    norm = lambda s: re.sub(r"\s+", "", (s or "").lower())
    return norm(motif) in norm(texte)


def _cibles_seuils() -> list[dict]:
    from app.agents.guidance.roadmap import seuils as S

    micro = S.bloc("micro")
    tva = S.bloc("tva_franchise")
    return [
        {"label": "Plafond micro-BNC", "valeur": int(micro["bnc"]["seuil"]),
         "source": micro["bnc"]["source"]},
        {"label": "Plafond micro-BIC vente", "valeur": int(micro["bic_vente"]["seuil"]),
         "source": micro["bic_vente"]["source"]},
        {"label": "Franchise TVA services (base)", "valeur": int(tva["services"]["seuil_base"]),
         "source": tva["services"]["source"]},
        {"label": "Franchise TVA services (majoré)", "valeur": int(tva["services"]["seuil_majore"]),
         "source": tva["services"]["source"]},
        {"label": "Franchise TVA vente (base)", "valeur": int(tva["vente"]["seuil_base"]),
         "source": tva["vente"]["source"]},
    ]


async def verifier_seuils() -> list[dict]:
    """Confronte chaque seuil versionné à sa source officielle. N'écrase jamais la valeur."""
    from app.mcp import client as mcp

    resultats = []
    for cible in _cibles_seuils():
        statut, detail = "inaccessible", ""
        try:
            page = await mcp.call_tool("docs-officiels", "fetch_page",
                                       {"cle_ou_url": cible["source"]})
            texte = page.get("texte", "") if isinstance(page, dict) else ""
            if texte:
                statut = "confirme" if _valeur_presente(cible["valeur"], texte) else "ecart_possible"
        except Exception as exc:  # noqa: BLE001
            detail = str(exc)
        if statut != "confirme":
            logger.warning("Veille seuils — %s (%s) : %s %s",
                           cible["label"], cible["valeur"], statut, detail)
        resultats.append({**cible, "statut": statut, "detail": detail})
    return resultats


def _cibles_echeancier() -> list[dict]:
    """Obligations du Rule Engine (data/regimes/*.yaml) qui portent un `verif_motif` — le fait
    précis à reconfirmer à la source (ex. "15 décembre" pour la CFE). Une obligation sans motif
    n'est pas vérifiée ici (mais reste ré-ingérée dans le corpus, voir `_collecter`)."""
    from app.agents.echeancier import regles

    cibles = []
    for regime in ("micro",):  # seuls régimes renseignés aujourd'hui (voir data/regimes/)
        for obligation in regles.obligations_pour_regime(regime):
            if obligation.get("verif_motif"):
                cibles.append(obligation)
    return cibles


async def verifier_echeancier() -> list[dict]:
    """Confronte le fait clé de chaque règle d'échéance à sa source officielle. N'écrase JAMAIS
    `data/regimes/*.yaml` automatiquement — un écart est seulement signalé, la correction reste
    une décision humaine (même principe que verifier_seuils pour seuils.yaml)."""
    from app.mcp import client as mcp

    resultats = []
    for cible in _cibles_echeancier():
        statut, detail = "inaccessible", ""
        try:
            page = await mcp.call_tool("docs-officiels", "fetch_page",
                                       {"cle_ou_url": cible["source"]})
            texte = page.get("texte", "") if isinstance(page, dict) else ""
            if texte:
                statut = "confirme" if _motif_present(cible["verif_motif"], texte) else "ecart_possible"
        except Exception as exc:  # noqa: BLE001
            detail = str(exc)
        if statut != "confirme":
            logger.warning("Veille échéancier — %s (%s) : %s %s",
                           cible["libelle"], cible["verif_motif"], statut, detail)
        resultats.append({"label": cible["libelle"], "valeur": cible["verif_motif"],
                          "source": cible["source"], "statut": statut, "detail": detail})
    return resultats


async def _resumer_et_classer(titre: str, texte: str) -> dict:
    systeme = (
        "Tu analyses une publication fiscale/juridique française. Réponds en JSON strict : "
        '{"resume":"3 phrases max","concerne":["influenceur"|"freelance"|"tous"],'
        '"impact":"concret pour un créateur","pertinent":true|false}. '
        "pertinent=false si le texte ne concerne pas les créateurs/indépendants."
    )
    try:
        return await chat_json_with_system(
            systeme, f"Titre : {titre}\n\nTexte : {texte[:6000]}",
            temperature=0.1, max_tokens=400,
        )
    except Exception as exc:  # noqa: BLE001
        return {"resume": "", "concerne": ["tous"], "impact": "", "pertinent": True,
                "erreur": str(exc)}


async def _collecter() -> list[dict]:
    """Interroge les serveurs MCP et renvoie une liste unifiée de candidats."""
    from app.mcp import client as mcp

    items: list[dict] = []

    try:
        res = await mcp.call_tool("legifrance", "legifrance_search",
                                  {"mots_cles": MOTS_CLES, "taille": 8})
        for r in res.get("resultats", []):
            items.append({"titre": r["titre"], "url": r["url"], "source": "Legifrance",
                          "texte": r["titre"], "autorite": 1, "concerne": None})
    except Exception as exc:  # noqa: BLE001
        logger.warning("MCP legifrance indisponible : %s", exc)

    try:
        res = await mcp.call_tool("bofip", "bofip_search",
                                  {"requete": "avantages en nature revenus non commerciaux",
                                   "limite": 4})
        for d in res.get("documents", []):
            items.append({"titre": d["titre"], "url": d["url"], "source": "BOFiP",
                          "texte": d["extrait"], "autorite": 2, "concerne": ["tous"]})
    except Exception as exc:  # noqa: BLE001
        logger.warning("MCP bofip indisponible : %s", exc)

    try:
        res = await mcp.call_tool("web-sources", "check_updates", {})
        for n in res.get("nouveautes", []):
            if "erreur" in n:
                continue
            items.append({"titre": f"MAJ {n['source']}", "url": n["url"], "source": n["source"],
                          "texte": n["texte"], "autorite": 2,
                          "concerne": n.get("concerne", ["tous"])})
    except Exception as exc:  # noqa: BLE001
        logger.warning("MCP web-sources indisponible : %s", exc)

    for cle, autorite in (("impots_actualites", 2), ("loi_finances_2026", 1),
                          ("boss_avantages_nature", 2)):
        try:
            n = await mcp.call_tool("docs-officiels", "fetch_page", {"cle_ou_url": cle})
            if n.get("texte"):
                items.append({"titre": f"{n.get('source', 'DGFiP')} — {cle}", "url": n["url"],
                              "source": n.get("source", "DGFiP"), "texte": n["texte"],
                              "autorite": autorite, "concerne": n.get("concerne", ["tous"])})
        except Exception as exc:  # noqa: BLE001
            logger.warning("MCP docs-officiels (%s) indisponible : %s", cle, exc)

    # Échéancier fiscal (chantier 6) — mêmes sources que data/regimes/*.yaml. Ré-ingérées à
    # chaque cycle : le corpus RAG du pédagogue reste dynamique sans appel réseau direct depuis
    # l'agenda (qui, lui, ne lit jamais que le résultat déjà en cache/le Rule Engine).
    try:
        from app.agents.echeancier import regles as echeancier_regles

        vues: set[str] = set()
        for obligation in echeancier_regles.obligations_pour_regime("micro"):
            url = obligation["source"]
            if url in vues:
                continue
            vues.add(url)
            try:
                page = await mcp.call_tool("docs-officiels", "fetch_page", {"cle_ou_url": url})
                if page.get("texte"):
                    items.append({"titre": obligation["libelle"], "url": url, "source": "DGFiP/Service-Public",
                                  "texte": page["texte"], "autorite": 2, "concerne": ["tous"]})
            except Exception as exc:  # noqa: BLE001
                logger.warning("MCP docs-officiels (échéancier %s) indisponible : %s", obligation["id"], exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Rule Engine échéancier indisponible pour la veille : %s", exc)

    return items


async def run_veille() -> dict:
    """Un cycle complet : collecte, résumé/classement, ré-ingestion, contrôle des seuils."""
    candidats = await _collecter()
    rapport = []
    for c in candidats:
        analyse = await _resumer_et_classer(c["titre"], c["texte"])
        if not analyse.get("pertinent", True):
            continue
        concerne = analyse.get("concerne") or c.get("concerne") or ["tous"]
        await ingest_document(
            text=c["texte"], source=c["source"], titre=c["titre"], url=c["url"],
            type_doc="actualite", autorite=c.get("autorite", 2), concerne=concerne,
        )
        rapport.append({"titre": c["titre"], "source": c["source"], "url": c["url"],
                        "resume": analyse.get("resume", ""), "impact": analyse.get("impact", ""),
                        "concerne": concerne})

    seuils_verif = await verifier_seuils()
    ecarts = [s for s in seuils_verif if s["statut"] == "ecart_possible"]

    echeancier_verif = await verifier_echeancier()
    echeancier_ecarts = [s for s in echeancier_verif if s["statut"] == "ecart_possible"]

    global _dernier_rapport
    _dernier_rapport = {"nouveautes": rapport, "seuils": seuils_verif,
                        "seuils_ecarts": len(ecarts),
                        "echeancier": echeancier_verif,
                        "echeancier_ecarts": len(echeancier_ecarts),
                        "date": datetime.now().isoformat()}
    logger.info("Veille terminée : %d nouveauté(s), %d écart(s) de seuil, %d écart(s) d'échéancier",
                len(rapport), len(ecarts), len(echeancier_ecarts))
    return _dernier_rapport


def dernier_rapport() -> dict:
    return _dernier_rapport


def start_scheduler():
    """Planifie la veille quotidienne. Renvoie None si elle est désactivée (défaut)."""
    if not settings.veille_enabled:
        return None
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
    except ImportError:
        logger.warning("APScheduler absent : veille non planifiée (installez apscheduler).")
        return None

    async def cycle_complet():
        """Corpus RAG + contrôle des seuils, PUIS alimentation du catalogue personnalisé."""
        await run_veille()
        from app.veille.agent import run_cycle

        await run_cycle()

    scheduler = AsyncIOScheduler()
    scheduler.add_job(cycle_complet, "cron", hour=settings.veille_cron_hour,
                      id="veille_quotidienne")
    scheduler.start()
    logger.info("Veille planifiée tous les jours à %sh", settings.veille_cron_hour)
    return scheduler
