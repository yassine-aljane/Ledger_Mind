"""Agent de guidance : génération DÉTERMINISTE de la roadmap + court message d'accompagnement.

La feuille de route est produite exclusivement par build_roadmap() (moteur déterministe).
Le LLM ne rédige QUE 2 à 4 phrases d'accompagnement — il ne décide de rien, n'énumère aucune
étape, ne cite aucun seuil ni source (cf. prompt système ci-dessous, chantier 3).
"""
from __future__ import annotations

import json
import logging
import re

from app.llm.mistral_client import chat
from app.roadmap import parcours
# La roadmap est construite par le moteur à embranchements (déterministe, seuils sourcés).
# On ré-exporte build_roadmap ici pour compat avec main.py (guidance.build_roadmap).
from app.roadmap.parcours import build_roadmap  # noqa: F401  (ré-export volontaire)

log = logging.getLogger("guidance")

_JSON_ABSENT = "La feuille de route n'a pas encore été générée."

# --- Prompt système de génération de la roadmap (accompagnement uniquement) ---
ROADMAP_SYSTEME = """# RÔLE

Tu ne construis PAS la feuille de route.

Elle est produite exclusivement par le moteur déterministe build_roadmap(), qui applique les
règles légales françaises à partir de seuils versionnés et sourcés.

Tu ne décides jamais : des étapes, de leur ordre, du régime, des obligations, des seuils, des
taux, des formulaires, des administrations, des délais, des coûts, des comparatifs.
Ces informations viennent uniquement du JSON. Toute contradiction avec ce JSON est interdite.

# ENTRÉE

Tu reçois : le profil utilisateur, le verdict déterministe (dont les champs `regime` et
`durabilite`), et le JSON de build_roadmap().

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
    • indetermine          → voir section CAS PARTICULIERS.

Ne présuppose JAMAIS qu'un chiffre d'affaires élevé implique un dépassement : seul le champ
`durabilite` fait foi.

# CE QUE TU NE DOIS JAMAIS FAIRE

- énumérer ou résumer les étapes, sous quelque forme que ce soit ;
- produire une liste, une checklist, un tableau ou un comparatif ;
- citer un seuil, un taux, un montant, un délai, un coût, un formulaire ou une administration ;
- citer une source (le composant les affiche déjà) ;
- reproduire un marqueur interne du contexte (par exemple un bloc entre crochets signalant une
  position déterministe) : ce sont des contraintes internes, jamais du contenu à restituer ;
- utiliser des emoji ou du markdown.

Tu peux écrire naturellement, connecteurs inclus. L'interdiction porte sur l'ÉNUMÉRATION
D'ÉTAPES, pas sur le vocabulaire.

# CAS PARTICULIERS

- JSON absent → réponds exactement : « La feuille de route n'a pas encore été générée. »
  Ne tente jamais de la reconstruire.
- `durabilite` = indetermine → il manque une information pour trancher. Ne donne aucune
  recommandation : pose en une phrase la question manquante indiquée par le verdict.

# SORTIE

Texte brut. 2 à 4 phrases. Rien d'autre."""

# Repli déterministe si le LLM échoue la validation deux fois (aucun contenu interdit).
_ACCOMPAGNEMENT_REPLI = ("Voici ta feuille de route personnalisée, adaptée à ta situation. "
                         "Prends-la étape par étape, à ton rythme.")

_EMOJI = re.compile(
    r"[←-⇿①-➿⬀-⯿️]"
    r"|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDFFF]"
)


def _nb_phrases(texte: str) -> int:
    return len([p for p in re.split(r"(?<=[.!?…])\s+", texte.strip()) if p.strip()])


def _accompagnement_valide(texte: str) -> tuple[bool, str]:
    """Contrôle de sortie (chantier 3.2). Renvoie (ok, motif_rejet)."""
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
    """Contexte minimal transmis au LLM : profil + verdict. On ne passe PAS le détail des étapes
    (le LLM ne doit ni les énumérer ni les résumer)."""
    v = {
        "regime": roadmap["bandeau"]["titre"],
        "durabilite": roadmap.get("durabilite"),
        "question_manquante": verdict.get("question_manquante"),
    }
    resume = {"parcours": roadmap["parcours"], "nb_etapes": len(roadmap.get("etapes", [])),
              "nb_phases": len(roadmap.get("phases", []))}
    return (f"Profil utilisateur : {json.dumps(profil, ensure_ascii=False)}\n"
            f"Verdict déterministe : {json.dumps(v, ensure_ascii=False)}\n"
            f"Roadmap (résumé, ne pas énumérer) : {json.dumps(resume, ensure_ascii=False)}")


async def _rediger_accompagnement(message: str, contexte: str) -> str:
    """Appelle le LLM, valide, régénère une fois si invalide, sinon repli déterministe."""
    for tentative in range(2):
        rappel = "" if tentative == 0 else (
            "\n\nRAPPEL STRICT : 2 à 4 phrases, texte brut, aucune liste, aucun emoji, "
            "aucun markdown, aucun symbole € ou %, aucune étape énumérée.")
        messages = [
            {"role": "system", "content": ROADMAP_SYSTEME},
            {"role": "user", "content": f"Message de l'utilisateur (pour le ton) : {message}\n\n"
                                        f"{contexte}{rappel}"},
        ]
        texte = (await chat(messages, temperature=0.2, max_tokens=220)).strip()
        ok, motif = _accompagnement_valide(texte)
        if ok:
            return texte
        log.warning("Accompagnement roadmap rejeté (tentative %d) : %s — %r", tentative + 1, motif, texte[:120])
    return _ACCOMPAGNEMENT_REPLI


async def guidance_chat(message: str, profil: dict | None = None) -> dict:
    """Génère la roadmap déterministe + un court message d'accompagnement (2 à 4 phrases)."""
    profil = profil or {}
    roadmap = build_roadmap(profil) if profil else None

    # 3.1 — JSON absent : aucun appel LLM, phrase exacte renvoyée directement.
    if not roadmap:
        return {"reponse": _JSON_ABSENT, "roadmap": None, "sources": []}

    verdict = parcours.verdict_regime(profil) or {}
    reponse = await _rediger_accompagnement(message, _contexte_llm(profil, roadmap, verdict))
    # Les sources sont portées par la roadmap (legal_sources) et affichées par le composant.
    return {"reponse": reponse, "roadmap": roadmap, "sources": []}
