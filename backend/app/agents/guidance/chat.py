"""Génération DÉTERMINISTE de la feuille de route + court message d'accompagnement.

La feuille de route est produite exclusivement par `build_roadmap()` (moteur déterministe,
seuils versionnés et sourcés). Le LLM ne rédige QUE 2 à 4 phrases d'accompagnement : il ne
décide de rien, n'énumère aucune étape, ne cite ni seuil ni source — et sa sortie est validée
par le code, avec un repli déterministe si elle ne l'est pas.
"""

from __future__ import annotations

import json
import logging
import re

from app.agents.guidance.roadmap import parcours
from app.agents.guidance.roadmap.parcours import build_roadmap
from app.llm import chat_text

logger = logging.getLogger(__name__)

_JSON_ABSENT = "La feuille de route n'a pas encore été générée."

ROADMAP_SYSTEME = """# RÔLE

Tu ne construis PAS la feuille de route.

Elle est produite exclusivement par le moteur déterministe build_roadmap(), qui applique les
règles légales françaises à partir de seuils versionnés et sourcés.

Tu ne décides jamais : des étapes, de leur ordre, du régime, des obligations, des seuils, des
taux, des formulaires, des administrations, des délais, des coûts, des comparatifs.
Ces informations viennent uniquement du JSON. Toute contradiction avec ce JSON est interdite.

# ENTRÉE

Tu reçois : le profil utilisateur, le verdict déterministe (dont les champs `regime` et
`durabilite`), et un résumé du JSON de build_roadmap().

# TA MISSION

Produire UNIQUEMENT un message d'accompagnement de 2 à 4 phrases, en français, qui :
- resitue la situation de la personne dans ses propres termes ;
- indique que la feuille de route ci-dessous est personnalisée ;
- invite à la parcourir.

Ton : chaleureux, clair, jamais culpabilisant. La personne peut être débutante et inquiète.
Tutoiement si l'utilisateur tutoie, vouvoiement sinon.

# CE QUE TU PEUX MENTIONNER

Uniquement en le déduisant du verdict, sans jamais l'inventer :
- le régime retenu, nommé simplement ;
- une nuance de durabilité, STRICTEMENT selon le champ `durabilite` :
    • eligible_stable      → aucune alerte. N'évoque NI dépassement NI anticipation.
    • depassement_ponctuel → signale que la situation est à surveiller, sans dramatiser.
    • depassement_durable  → indique clairement qu'un changement de régime est à prévoir, sans
                             présenter la tolérance comme une solution durable.
    • indetermine          → il manque une information : pose en une phrase la question manquante.

Ne présuppose JAMAIS qu'un chiffre d'affaires élevé implique un dépassement : seul le champ
`durabilite` fait foi.

# CE QUE TU NE DOIS JAMAIS FAIRE

- énumérer ou résumer les étapes, sous quelque forme que ce soit ;
- produire une liste, une checklist, un tableau ou un comparatif ;
- citer un seuil, un taux, un montant, un délai, un coût, un formulaire ou une administration ;
- citer une source (le composant les affiche déjà) ;
- utiliser des emoji ou du markdown.

# SORTIE

Texte brut. 2 à 4 phrases. Rien d'autre."""

_ACCOMPAGNEMENT_REPLI = (
    "Voici ta feuille de route personnalisée, adaptée à ta situation. "
    "Prends-la étape par étape, à ton rythme."
)

_EMOJI = re.compile(
    r"[←-⇿①-➿⬀-⯿️]"
    r"|\ud83c[\udc00-\udfff]|\ud83d[\udc00-\udfff]|\ud83e[\udd00-\udfff]"
)


def _nb_phrases(texte: str) -> int:
    return len([p for p in re.split(r"(?<=[.!?…])\s+", texte.strip()) if p.strip()])


def accompagnement_valide(texte: str) -> tuple[bool, str]:
    """Contrôle de sortie du LLM. Renvoie (ok, motif_rejet)."""
    t = (texte or "").strip()
    if not t:
        return False, "vide"
    if _EMOJI.search(t):
        return False, "emoji"
    if "€" in t or "%" in t:
        return False, "symbole € ou %"
    if "|" in t:
        return False, "tableau"
    if re.search(r"(?m)^\s*(?:[-*•]|\d+[.)])\s+", t):
        return False, "liste/puce"
    if re.search(r"(?m)^\s*#", t):
        return False, "markdown titre"
    if _nb_phrases(t) > 4:
        return False, "plus de 4 phrases"
    return True, ""


def _contexte_llm(profil: dict, roadmap: dict, verdict: dict) -> str:
    """Contexte minimal : profil + verdict. Le détail des étapes n'est PAS transmis (le LLM ne
    doit ni les énumérer ni les résumer)."""
    v = {
        "regime": roadmap["bandeau"]["titre"],
        "durabilite": roadmap.get("durabilite"),
        "question_manquante": verdict.get("question_manquante"),
    }
    resume = {
        "parcours": roadmap["parcours"],
        "nb_etapes": len(roadmap.get("etapes", [])),
        "nb_phases": len(roadmap.get("phases", [])),
    }
    return (
        f"Profil utilisateur : {json.dumps(profil, ensure_ascii=False)}\n"
        f"Verdict déterministe : {json.dumps(v, ensure_ascii=False)}\n"
        f"Roadmap (résumé, ne pas énumérer) : {json.dumps(resume, ensure_ascii=False)}"
    )


async def _rediger_accompagnement(message: str, contexte: str) -> str:
    """Appelle le LLM, valide, régénère une fois si invalide, sinon repli déterministe."""
    for tentative in range(2):
        rappel = "" if tentative == 0 else (
            "\n\nRAPPEL STRICT : 2 à 4 phrases, texte brut, aucune liste, aucun emoji, "
            "aucun markdown, aucun symbole € ou %, aucune étape énumérée."
        )
        try:
            texte = await chat_text(
                ROADMAP_SYSTEME,
                f"Message de l'utilisateur (pour le ton) : {message}\n\n{contexte}{rappel}",
                temperature=0.2,
                max_tokens=220,
            )
        except Exception as exc:  # noqa: BLE001 — le LLM ne doit jamais bloquer la roadmap
            logger.warning("Accompagnement indisponible : %s", exc)
            return _ACCOMPAGNEMENT_REPLI
        ok, motif = accompagnement_valide(texte)
        if ok:
            return texte
        logger.warning("Accompagnement rejeté (tentative %d) : %s — %r",
                       tentative + 1, motif, texte[:120])
    return _ACCOMPAGNEMENT_REPLI


async def guidance_chat(message: str, profil: dict | None = None) -> dict:
    """Feuille de route déterministe + message d'accompagnement (2 à 4 phrases)."""
    profil = profil or {}
    roadmap = build_roadmap(profil) if profil else None

    # JSON absent : aucun appel LLM, phrase exacte renvoyée directement.
    if not roadmap:
        return {"reponse": _JSON_ABSENT, "roadmap": None, "sources": []}

    verdict = parcours.verdict_regime(profil) or {}
    reponse = await _rediger_accompagnement(message, _contexte_llm(profil, roadmap, verdict))
    # Les sources sont portées par la roadmap (legal_sources) et affichées par le composant.
    return {"reponse": reponse, "roadmap": roadmap, "sources": []}
