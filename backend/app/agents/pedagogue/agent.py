"""Agent pédagogique : Q&A fiscale ANCRÉE sur le corpus (RAG), qui cite ses sources.

Il répond à partir des extraits, refuse d'inventer un chiffre absent, avertit quand une source
risque d'être périmée, et s'aligne STRICTEMENT sur le verdict déterministe du régime quand il
lui est fourni (jamais de contradiction avec la feuille de route).
"""

from __future__ import annotations

import logging
import json
import math
import re

from app.llm import chat_text
from app.rag.retriever import search

logger = logging.getLogger(__name__)

# Mots vides français : retirés de la question avant d'interroger BOFiP (l'API ne répond pas à
# une phrase en langage naturel, mais fonctionne sur des mots-clés).
_MOTS_VIDES = frozenset({
    "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "me", "te", "se",
    "le", "la", "les", "un", "une", "des", "du", "de", "ce", "cet", "cette", "ces",
    "mon", "ton", "son", "ma", "ta", "sa", "mes", "tes", "ses", "et", "ou", "mais",
    "donc", "car", "que", "qui", "quoi", "dont", "au", "aux", "en", "dans", "sur",
    "sous", "par", "pour", "avec", "sans", "chez", "vers", "dois", "doit", "est",
    "sont", "ai", "as", "avons", "avez", "ont", "etre", "avoir", "faire", "si", "ne",
    "pas", "plus", "moins", "tres", "bien", "quel", "quelle", "quels", "quelles",
    "comment", "quand", "combien", "puis", "cas", "aussi", "leur", "leurs",
})

# En dessous de cette similarité, le corpus local est jugé faible sur la question : on
# interroge la doctrine BOFiP en direct. Seuil bas volontairement — injecter des extraits
# faiblement pertinents sur une question déjà couverte pousse le modèle vers le refus.
_SEUIL_BOFIP_LIVE = 0.80

SYSTEME = """Tu es l'assistant pédagogique fiscal de LedgerMind, spécialisé dans la fiscalité
française des créateurs de contenu, influenceurs et freelances. Tu es accessible même aux
personnes non immatriculées.

RÈGLES ABSOLUES :
- Réponds à partir des extraits de corpus fournis, en t'appuyant sur les PRINCIPES GÉNÉRAUX
  qu'ils énoncent (ex : un avantage ou un bien reçu en contrepartie d'une activité est un revenu
  imposable), même si aucun extrait ne traite le cas EXACT de la question. Commence DIRECTEMENT
  par la réponse, sans phrase d'excuse préalable.
- Cite tes sources entre crochets [Source — Titre].
- Ne refuse QUE si AUCUN extrait n'est pertinent pour la question. Dans ce seul cas, dis :
  "Je n'ai pas de source fiable sur ce point dans ma base ; vérifie auprès de impots.gouv.fr
  ou d'un expert-comptable."
- N'INVENTE JAMAIS un chiffre, un seuil, un taux, une date ou un article de loi absent des
  extraits. Si un détail chiffré précis manque, signale-le EN FIN de réponse et oriente vers
  impots.gouv.fr ou un expert-comptable — sans que cela empêche la réponse de principe.
- Tu vulgarises : phrases courtes, pas de jargon sans le définir, exemples concrets.
- Tu ne donnes pas de conseil fiscal engageant : tu informes et tu orientes.
- Si une source est signalée comme potentiellement périmée, ajoute un avertissement de fraîcheur.
- RÉGIME (micro / société / à arbitrer) : si une POSITION DÉTERMINISTE SUR LE RÉGIME t'est fournie,
  elle fait autorité (elle est calculée par l'outil à partir des seuils officiels et de la règle de
  tolérance N-1/N-2). Aligne-toi STRICTEMENT dessus : n'affirme jamais une conclusion de régime
  différente. En particulier, un CA qui dépasse le plafond micro une seule année n'exclut PAS du
  micro (sortie seulement après 2 années consécutives) : ne réponds donc jamais « impossible » ou
  « pas adapté » de façon couperet si la position déterministe indique « à arbitrer ».

TROIS DIMENSIONS À COUVRIR (quand la question porte sur un revenu ou un avantage REÇU —
produits offerts, cadeaux, dotations, gifting, rémunération en nature) : ne traite pas que
l'impôt. Aborde systématiquement, dès que les extraits le permettent, les trois volets :
  1. FISCALE : l'avantage est un revenu imposable à sa valeur vénale (valeur réelle du bien).
  2. SOCIALE : cette valeur entre aussi dans l'assiette des cotisations et contributions sociales.
  3. IMPACT SEUILS : elle compte dans le chiffre d'affaires, donc dans les seuils du régime micro
     ET de la franchise en base de TVA.
Ne donne un chiffre précis (seuil, taux, plafond d'exonération) que s'il figure dans les extraits.

CATÉGORIE BNC / BIC : elle dépend de la NATURE de l'activité, jamais du statut juridique. Une
prestation de promotion / création de contenu relève des BNC ; la vente de biens relève des BIC.
Ne confonds pas la catégorie fiscale (BNC/BIC) avec le régime (micro vs réel) ni avec le statut.

DÉCLARATION : le micro (BNC comme BIC) se déclare à l'impôt sur la déclaration 2042-C-PRO ; le
régime réel ajoute une liasse fiscale spécifique. La déclaration de chiffre d'affaires à l'URSSAF
est un circuit DISTINCT (cotisations sociales) qui se CUMULE avec la déclaration fiscale : n'oppose
jamais « micro-entrepreneur » et « régime réel » sur le formulaire 2042-C-PRO.

VISUALISATIONS (facultatives) :
- La réponse textuelle reste obligatoire et autonome.
- Ajoute une visualisation UNIQUEMENT si elle rend une comparaison, une évolution ou plusieurs
  valeurs nettement plus compréhensibles. N'en ajoute pas à une réponse simple.
- Toutes les valeurs doivent provenir explicitement des extraits fournis ou de la position
  déterministe. N'invente aucune donnée pour compléter un graphe ou un tableau.
- Un graphe exige au moins 2 valeurs numériques comparables avec la même unité. Utilise `bar`
  pour comparer des catégories et `line` seulement pour une évolution ordonnée dans le temps.
- Utilise `table` pour une comparaison mêlant du texte et des valeurs.
- Maximum 2 visualisations et 8 points/lignes par visualisation.
- Place chaque structure APRÈS la réponse sous cette forme exacte, sans bloc Markdown :
  <visualisation>{"type":"bar","title":"Titre","unit":"%","data":[{"label":"A","value":10},{"label":"B","value":20}]}</visualisation>
  ou
  <visualisation>{"type":"table","title":"Titre","columns":["Critère","Option A","Option B"],"rows":[["Règle","Valeur A","Valeur B"]]}</visualisation>
"""

CORPUS_VIDE = (
    "Ma base documentaire n'est pas encore prête. Réessayez dans un instant — "
    "si le problème continue, l'équipe doit réamorcer l'index des textes officiels."
)

RECHERCHE_INDISPONIBLE = (
    "Je ne peux pas interroger ma base documentaire pour le moment. Réessayez dans un instant — "
    "je préfère ne rien affirmer plutôt que de répondre sans source."
)

_VISUALISATION_RE = re.compile(
    r"<visualisation>\s*(\{.*?\})\s*</visualisation>", re.DOTALL | re.IGNORECASE,
)


def _texte_court(value: object, limite: int = 120) -> str:
    """Cellule/étiquette bornée : évite qu'un payload LLM gonfle la réponse ou le DOM."""
    if value is None:
        return "—"
    return str(value).strip()[:limite]


def _valider_visualisation(brut: object) -> dict | None:
    """Valide et normalise le petit contrat de dataviz produit par le modèle."""
    if not isinstance(brut, dict):
        return None
    kind = brut.get("type")
    titre = _texte_court(brut.get("title"), 100)
    if not titre or kind not in {"bar", "line", "table"}:
        return None

    if kind in {"bar", "line"}:
        data = brut.get("data")
        if not isinstance(data, list) or not 2 <= len(data) <= 8:
            return None
        points: list[dict] = []
        for point in data:
            if not isinstance(point, dict):
                return None
            label = _texte_court(point.get("label"), 50)
            value = point.get("value")
            if (not label or isinstance(value, bool) or not isinstance(value, (int, float))
                    or not math.isfinite(float(value))):
                return None
            points.append({"label": label, "value": float(value)})
        return {
            "type": kind,
            "title": titre,
            "unit": _texte_court(brut.get("unit"), 16),
            "data": points,
        }

    columns = brut.get("columns")
    rows = brut.get("rows")
    if (not isinstance(columns, list) or not 2 <= len(columns) <= 6
            or not isinstance(rows, list) or not 1 <= len(rows) <= 8):
        return None
    entetes = [_texte_court(c, 60) for c in columns]
    if any(not c for c in entetes):
        return None
    lignes: list[list[str]] = []
    for row in rows:
        if not isinstance(row, list) or len(row) != len(entetes):
            return None
        lignes.append([_texte_court(cell) for cell in row])
    return {"type": "table", "title": titre, "columns": entetes, "rows": lignes}


def extraire_visualisations(reponse: str) -> tuple[str, list[dict]]:
    """Retire les payloads structurés du texte et ne conserve que ceux qui sont valides."""
    visualisations: list[dict] = []
    for match in _VISUALISATION_RE.finditer(reponse or ""):
        if len(visualisations) >= 2:
            break
        try:
            validee = _valider_visualisation(json.loads(match.group(1)))
        except (json.JSONDecodeError, TypeError, ValueError):
            validee = None
        if validee:
            visualisations.append(validee)
    texte = _VISUALISATION_RE.sub("", reponse or "").strip()
    return texte, visualisations


def mots_cles(question: str) -> str:
    """Réduit une question en langage naturel à ses mots-clés, pour la recherche BOFiP."""
    q = re.sub(r"[^\w\sàâäéèêëîïôöùûüç-]", " ", question.lower())
    mots: list[str] = []
    for mot in re.split(r"[\s-]+", q):
        if len(mot) >= 3 and mot not in _MOTS_VIDES and mot not in mots:
            mots.append(mot)
    return " ".join(mots)


async def _bofip_live(question: str) -> list[dict]:
    """Doctrine BOFiP interrogée en direct quand le corpus local est faible sur la question."""
    requete = mots_cles(question)
    if not requete:
        return []
    try:
        from app.mcp import client as mcp

        res = await mcp.call_tool("bofip", "bofip_search", {"requete": requete, "limite": 3})
    except Exception as exc:  # noqa: BLE001 — MCP indisponible : on répond avec le corpus local
        logger.info("Repli BOFiP indisponible : %s", exc)
        return []

    sorties = []
    for doc in res.get("documents", []):
        if doc.get("extrait"):
            sorties.append({
                "source": "BOFiP (live)", "titre": doc["titre"], "url": doc["url"],
                "texte": doc["extrait"], "date_publication": "en vigueur",
                "score": 0.78, "similarite": 0.78, "perime": False,
            })
    return sorties


async def answer(question: str, concerne: str | None = None, profil: dict | None = None,
                 historique: list[dict] | None = None,
                 regime_verdict: dict | None = None) -> dict:
    """Répond à une question fiscale en citant ses sources."""
    resultat = await search(question, k=8, concerne=concerne)

    if resultat["corpus_vide"]:
        return {"reponse": CORPUS_VIDE, "sources": [], "visualisations": [],
                "avertissement_fraicheur": False}
    if resultat.get("recherche_indisponible"):
        return {"reponse": RECHERCHE_INDISPONIBLE, "sources": [], "visualisations": [],
                "avertissement_fraicheur": False}

    hits = list(resultat["hits"])
    meilleure_similarite = hits[0].get("similarite", 0.0) if hits else 0.0
    live = await _bofip_live(question) if meilleure_similarite < _SEUIL_BOFIP_LIVE else []
    # On garde les 8 meilleurs extraits ; en cas de repli, le dernier cède la place au SEUL
    # meilleur résultat live (la recherche par mots-clés peut ramener du bruit par polysémie).
    hits = (hits[:7] + live[:1]) if live else hits[:8]

    extraits = "\n\n---\n\n".join(
        f"[{h['source']} — {h['titre']}] (publié {h['date_publication']})\n{h['texte']}"
        for h in hits
    )
    verdict_txt = ""
    if regime_verdict:
        verdict_txt = (
            f"\n\nPOSITION DÉTERMINISTE SUR LE RÉGIME (fait officiel calculé par l'outil, fait "
            f"autorité, à respecter sans le contredire ; NE la cite PAS comme une source, cite les "
            f"extraits du corpus) : parcours = {regime_verdict.get('parcours')}. "
            f"{regime_verdict.get('phrase', '')}"
        )

    prompt = (
        f"Question : {question}\n\n"
        f"Profil compact (contexte, jamais une source) : {profil or {}}\n"
        f"Historique récent (contexte, jamais une source) : {historique or []}"
        f"{verdict_txt}\n\nExtraits du corpus :\n{extraits}"
    )
    reponse_brute = await chat_text(SYSTEME, prompt, temperature=0.0, max_tokens=2400)
    reponse, visualisations = extraire_visualisations(reponse_brute)

    return {
        "reponse": reponse,
        "visualisations": visualisations,
        "sources": [
            {"source": h["source"], "titre": h["titre"], "url": h["url"],
             "date_publication": h["date_publication"], "score": h["score"], "perime": h["perime"]}
            for h in hits[:6]
        ],
        "avertissement_fraicheur": resultat["au_moins_un_perime"],
        "bofip_live_utilise": bool(live),
    }
