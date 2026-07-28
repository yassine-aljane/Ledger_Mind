"""Agent pédagogique : répond à toute question fiscale/juridique en s'ancrant sur le corpus (RAG)."""
from __future__ import annotations

import re

from app.llm.mistral_client import chat
from app.mcp import client as mcp
from app.rag.retriever import search

# Mots vides français : retirés de la question avant d'interroger BOFiP (l'API Opendatasoft
# ne renvoie rien sur une phrase complète en langage naturel, mais fonctionne sur des mots-clés).
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


def _mots_cles(question: str) -> str:
    """Réduit une question en langage naturel à ses mots-clés significatifs pour la recherche BOFiP."""
    q = re.sub(r"[^\w\sàâäéèêëîïôöùûüç-]", " ", question.lower())
    mots: list[str] = []
    for mot in re.split(r"[\s-]+", q):
        if len(mot) >= 3 and mot not in _MOTS_VIDES and mot not in mots:
            mots.append(mot)
    return " ".join(mots)

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
"""


async def answer(question: str, concerne: str | None = None, profil: dict | None = None,
                 historique: list[dict] | None = None, regime_verdict: dict | None = None) -> dict:
    r = search(question, k=8, concerne=concerne)

    if r["corpus_vide"]:
        return {
            "reponse": "Ma base documentaire est vide pour l'instant. Lance l'ingestion du corpus "
            "(scripts/seed_corpus.py) puis réessaie.",
            "sources": [],
            "avertissement_fraicheur": False,
        }

    # Repli BOFiP en direct : l'embedding e5 plafonne les similarités (~0.85). Quand aucun
    # extrait local ne matche fortement la question, on interroge la doctrine BOFiP opposable
    # pour cette question — après prétraitement en mots-clés — et on l'ajoute au contexte.
    hits = list(r["hits"])
    meilleure_sim = hits[0].get("similarite", 0.0) if hits else 0.0
    bofip_live = []
    # Seuil bas : on n'appelle BOFiP en direct que si le corpus local est RÉELLEMENT faible
    # sur la question. Injecter des extraits par mots-clés (parfois faiblement pertinents)
    # sur une question déjà bien couverte pousse le modèle vers la frontière réponse/refus.
    if meilleure_sim < 0.80:
        requete_bofip = _mots_cles(question)
        if requete_bofip:
            try:
                res = await mcp.call_tool(
                    "bofip", "bofip_search", {"requete": requete_bofip, "limite": 3}
                )
                for d in res.get("documents", []):
                    if d.get("extrait"):
                        bofip_live.append(
                            {"source": "BOFiP (live)", "titre": d["titre"], "url": d["url"],
                             "texte": d["extrait"], "date_publication": "en vigueur",
                             "score": 0.78, "similarite": 0.78, "perime": False}
                        )
            except Exception:  # noqa: BLE001
                pass
    # Fusion : on garde les 8 meilleurs extraits du corpus. Si un repli BOFiP live a été
    # déclenché (corpus faible), on remplace le dernier par le SEUL meilleur résultat live
    # (la recherche par mots-clés peut ramener du bruit par polysémie, ex. « produits »).
    hits = (hits[:7] + bofip_live[:1]) if bofip_live else hits[:8]

    extraits = "\n\n---\n\n".join(
        f"[{h['source']} — {h['titre']}] (publié {h['date_publication']})\n{h['texte']}"
        for h in hits
    )
    verdict_txt = ""
    if regime_verdict:
        verdict_txt = (
            f"\n\nPOSITION DÉTERMINISTE SUR LE RÉGIME (fait officiel calculé par l'outil, fait "
            f"autorité, à respecter sans le contredire ; NE la cite PAS comme une source, cite les "
            f"extraits du corpus) : parcours = {regime_verdict['parcours']}. {regime_verdict['phrase']}"
        )
    messages = [
        {"role": "system", "content": SYSTEME},
        {
            "role": "user",
            "content": f"Question : {question}\n\nProfil compact (contexte, jamais une source) : {profil or {}}\n"
                       f"Historique récent (contexte, jamais une source) : {historique or []}"
                       f"{verdict_txt}\n\nExtraits du corpus :\n{extraits}",
        },
    ]
    reponse = await chat(messages, temperature=0.0, max_tokens=2000)

    return {
        "reponse": reponse,
        "sources": [
            {
                "source": h["source"],
                "titre": h["titre"],
                "url": h["url"],
                "date_publication": h["date_publication"],
                "score": h["score"],
                "perime": h["perime"],
            }
            for h in hits[:6]
        ],
        "avertissement_fraicheur": r["au_moins_un_perime"],
        "bofip_live_utilise": bool(bofip_live),
    }
