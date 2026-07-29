"""Court accompagnement rédigé pour la feuille de route déterministe (aucun seuil inventé).

Passe par `app.llm` (Mistral pour ce domaine) plutôt que d'appeler un fournisseur en dur : ce
fichier avait son propre client OpenAI pointé sur Gemini, resté hors de la séparation de quota
entre l'agent intake et l'espace guidance — l'accompagnement tombait donc en repli silencieux
dès que le quota Gemini était épuisé, y compris quand tout le reste de la conversation
fonctionnait déjà sur Mistral.
"""

from __future__ import annotations

import json
import logging
import re

from app.llm import chat_text

logger = logging.getLogger(__name__)

ROADMAP_SYSTEME = """# RÔLE

Tu ne construis PAS la feuille de route.

Elle est produite exclusivement par le moteur déterministe build_roadmap(), qui applique les
règles légales françaises à partir de seuils versionnés et sourcés.

Tu ne décides jamais : des étapes, de leur ordre, du régime, des obligations, des seuils, des
taux, des formulaires, des administrations, des délais, des coûts, des comparatifs.
Ces informations viennent uniquement du JSON. Toute contradiction avec ce JSON est interdite.

# TA MISSION

Produire UNIQUEMENT un message d'accompagnement de 2 à 4 phrases, en français, qui :
- resitue la situation de la personne dans ses propres termes ;
- indique que la feuille de route ci-dessous est personnalisée ;
- invite à la parcourir.

Ton : chaleureux, clair, jamais culpabilisant. Vouvoiement.

# CE QUE TU PEUX MENTIONNER

Uniquement en le déduisant du verdict, sans jamais l'inventer :
- le régime retenu, nommé simplement ;
- une nuance de durabilité, STRICTEMENT selon le champ `durabilite` :
    • eligible_stable      → aucune alerte. N'évoque NI dépassement NI anticipation.
    • depassement_ponctuel → signale que la situation est à surveiller, sans dramatiser.
    • depassement_durable  → indique clairement qu'un changement de régime est à prévoir.
    • indetermine          → il manque une info ; ne donne aucune recommandation ferme.

# CE QUE TU NE DOIS JAMAIS FAIRE

- énumérer ou résumer les étapes ;
- produire une liste, checklist, tableau ou comparatif ;
- citer un seuil, un taux, un montant, un délai, un coût, un formulaire ou une administration ;
- utiliser des emoji ou du markdown.

# SORTIE

Texte brut. 2 à 4 phrases. Rien d'autre."""

_ACCOMPAGNEMENT_REPLI = (
    "Voici votre feuille de route personnalisée, adaptée à votre situation. "
    "Parcourez-la étape par étape, à votre rythme."
)

_EMOJI = re.compile(
    "["
    "\U0001F300-\U0001F9FF"
    "\u2600-\u26FF"
    "\u2700-\u27BF"
    "]"
)


def _nb_phrases(texte: str) -> int:
    return len([p for p in re.split(r"(?<=[.!?…])\s+", texte.strip()) if p.strip()])


def _accompagnement_valide(texte: str) -> tuple[bool, str]:
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


def _contexte_llm(profil: dict, roadmap: dict) -> str:
    v = {
        "regime": (roadmap.get("bandeau") or {}).get("titre"),
        "durabilite": roadmap.get("durabilite"),
    }
    resume = {
        "parcours": roadmap.get("parcours"),
        "nb_etapes": len(roadmap.get("etapes") or []),
        "nb_phases": len(roadmap.get("phases") or []),
    }
    return (
        f"Profil utilisateur : {json.dumps(profil, ensure_ascii=False)}\n"
        f"Verdict déterministe : {json.dumps(v, ensure_ascii=False)}\n"
        f"Roadmap (résumé, ne pas énumérer) : {json.dumps(resume, ensure_ascii=False)}"
    )


async def rediger_accompagnement(profil: dict, roadmap: dict, *, user_tone: str = "") -> str:
    contexte = _contexte_llm(profil, roadmap)
    for tentative in range(2):
        rappel = (
            ""
            if tentative == 0
            else (
                "\n\nRAPPEL STRICT : 2 à 4 phrases, texte brut, aucune liste, aucun emoji, "
                "aucun markdown, aucun symbole € ou %, aucune étape énumérée."
            )
        )
        try:
            texte = await chat_text(
                ROADMAP_SYSTEME,
                f"Message de l'utilisateur (pour le ton) : {user_tone or 'vouvoiement'}\n\n"
                f"{contexte}{rappel}",
                temperature=0.2,
                max_tokens=220,
                timeout=30.0,
            )
        except Exception as e:
            logger.warning("Accompagnement LLM failed: %s", e)
            return _ACCOMPAGNEMENT_REPLI
        ok, motif = _accompagnement_valide(texte)
        if ok:
            return texte
        logger.warning(
            "Accompagnement rejeté (tentative %d) : %s — %r",
            tentative + 1,
            motif,
            texte[:120],
        )
    return _ACCOMPAGNEMENT_REPLI
