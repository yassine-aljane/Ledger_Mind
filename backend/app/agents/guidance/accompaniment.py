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

Produire UNIQUEMENT un message d'accompagnement de 3 à 5 phrases, en français, qui :
- reconnaît concrètement l'activité et la situation décrites dans `profil_public` ;
- annonce le cap recommandé et sa logique, sans inventer de fait ;
- désigne UNE seule prochaine action en recopiant exactement `prochaine_action` ;
- présente la feuille de route comme un trajet personnalisé, clair et réalisable.

Ton : chaleureux, clair, jamais culpabilisant. Vouvoiement.

# CE QUE TU PEUX MENTIONNER

Uniquement en le déduisant du verdict, sans jamais l'inventer :
- le régime retenu, nommé simplement ;
- l'activité et la situation actuelle, seulement si elles figurent dans `profil_public` ;
- la prochaine action, uniquement en recopiant `prochaine_action` ;
- une nuance de durabilité, STRICTEMENT selon le champ `durabilite` :
    • eligible_stable      → aucune alerte. N'évoque NI dépassement NI anticipation.
    • depassement_ponctuel → signale que la situation est à surveiller, sans dramatiser.
    • depassement_durable  → indique clairement qu'un changement de régime est à prévoir.
    • indetermine          → il manque une info ; ne donne aucune recommandation ferme.

# CE QUE TU NE DOIS JAMAIS FAIRE

- énumérer ou résumer plusieurs étapes ;
- produire une liste, checklist, tableau ou comparatif ;
- citer un seuil, un taux, un montant, un délai, un coût, un formulaire ou une administration ;
- utiliser des emoji ou du markdown.

# SORTIE

Texte brut. 3 à 5 phrases. Rien d'autre."""

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
    phrases = _nb_phrases(t)
    if phrases < 3:
        return False, "moins de 3 phrases"
    if phrases > 5:
        return False, "plus de 5 phrases"
    return True, ""


def _accompagnement_repli(profil: dict, roadmap: dict) -> str:
    activite = str(profil.get("activite") or "").strip()
    sujet = f"votre activité « {activite} »" if activite else "votre activité"
    situation = str(profil.get("situation_actuelle") or "").strip()
    regime = str((roadmap.get("bandeau") or {}).get("titre") or "le parcours proposé").strip()
    etapes = roadmap.get("etapes") or []
    prochaine = str((etapes[0] if etapes else {}).get("titre") or "ouvrir la première étape").strip()
    contexte = f", compte tenu de votre situation actuelle ({situation})," if situation else ","
    return (
        f"Pour {sujet}{contexte} le cap recommandé est {regime}. "
        "La feuille de route ci-dessous transforme ce diagnostic en un trajet concret et personnalisé. "
        f"Commencez par « {prochaine} », puis avancez à votre rythme en validant chaque jalon."
    )


def _contexte_llm(profil: dict, roadmap: dict) -> str:
    v = {
        "regime": (roadmap.get("bandeau") or {}).get("titre"),
        "durabilite": roadmap.get("durabilite"),
    }
    profil_public = {
        key: profil.get(key)
        for key in ("activite", "situation_actuelle", "anciennete", "vend_produits", "recoit_cadeaux")
        if profil.get(key) is not None
    }
    etapes = roadmap.get("etapes") or []
    resume = {
        "parcours": roadmap.get("parcours"),
        "nb_etapes": len(roadmap.get("etapes") or []),
        "nb_phases": len(roadmap.get("phases") or []),
        "prochaine_action": (etapes[0] if etapes else {}).get("titre"),
    }
    return (
        f"Profil public utile au récit : {json.dumps(profil_public, ensure_ascii=False)}\n"
        f"Verdict déterministe : {json.dumps(v, ensure_ascii=False)}\n"
        f"Roadmap (résumé sûr) : {json.dumps(resume, ensure_ascii=False)}"
    )


async def rediger_accompagnement(profil: dict, roadmap: dict, *, user_tone: str = "") -> str:
    contexte = _contexte_llm(profil, roadmap)
    for tentative in range(2):
        rappel = (
            ""
            if tentative == 0
            else (
                "\n\nRAPPEL STRICT : 3 à 5 phrases, texte brut, aucune liste, aucun emoji, "
                "aucun markdown, aucun symbole € ou %, une seule prochaine action exacte."
            )
        )
        try:
            texte = await chat_text(
                ROADMAP_SYSTEME,
                f"Message de l'utilisateur (pour le ton) : {user_tone or 'vouvoiement'}\n\n"
                f"{contexte}{rappel}",
                temperature=0.35,
                max_tokens=320,
                timeout=30.0,
            )
        except Exception as e:
            logger.warning("Accompagnement LLM failed: %s", e)
            return _accompagnement_repli(profil, roadmap)
        ok, motif = _accompagnement_valide(texte)
        if ok:
            return texte
        logger.warning(
            "Accompagnement rejeté (tentative %d) : %s — %r",
            tentative + 1,
            motif,
            texte[:120],
        )
    return _accompagnement_repli(profil, roadmap)
