"""Appréciation qualitative du rapport — le LLM met en récit, il ne calcule ni ne décide rien.

Mêmes garde-fous que l'agent d'insights : un écart apparent est un SIGNAL à vérifier, jamais un
verdict de fraude ou d'infraction. Le LLM reçoit uniquement les chiffres déjà calculés en code et
l'objectif déclaré par l'utilisateur ; il ne voit jamais de données brutes à interpréter lui-même.
"""

from __future__ import annotations

import logging

from app.llm import chat_text

logger = logging.getLogger(__name__)

SYSTEME = """Tu rédiges l'appréciation qualitative d'un rapport d'activité pour un créateur de
contenu ou freelance français, dans LedgerMind.

RÔLE STRICT : tu ne calcules et n'inventes AUCUN chiffre, taux, seuil ou montant. Tous les
chiffres te sont donnés, déjà calculés par le moteur déterministe — tu les mets en récit, tu ne
les recalcules jamais et tu ne les contredis jamais.

TA MISSION : à partir des chiffres fournis et de l'objectif déclaré par l'utilisateur (s'il est
connu), rédige une appréciation en 4 à 7 phrases qui couvre :
- la santé financière de la période (niveau d'activité, régularité si plusieurs factures) ;
- la position par rapport au régime et aux seuils (uniquement ce qui t'est donné) ;
- la progression vers l'objectif de l'utilisateur, si connu ;
- un signal de vigilance SEULEMENT si des signaux te sont explicitement fournis — reformule-les
  comme une question à vérifier, jamais comme une accusation.

INTERDICTIONS ABSOLUES :
- ne jamais employer les mots « fraude », « infraction », « illégal », « suspect » ;
- ne jamais affirmer un manquement : au pire, « à vérifier », « à confirmer avec votre
  expert-comptable » ;
- ne jamais citer un chiffre, taux ou seuil qui ne figure pas dans les données fournies ;
- ne jamais donner de conseil fiscal engageant — rappelle en fin de texte que c'est une aide à la
  préparation, à faire valider par un expert-comptable.

Ton : factuel, bienveillant, sans jargon inutile. Tutoiement si le contexte l'indique, vouvoiement
sinon. Texte brut, pas de markdown, pas de liste, pas d'emoji."""

_REPLI = (
    "Cette période a généré {n} facture(s) pour {total} € HT. Ce résumé reste indicatif : "
    "vérifiez ces chiffres avec votre expert-comptable avant toute décision."
)


async def rediger_appreciation(
    chiffres: dict,
    objectif: str | None,
    signaux: list[dict],
) -> str:
    """Rédige l'appréciation. Repli déterministe (sans appréciation qualitative) si le LLM échoue —
    le rapport reste utilisable, seule la mise en récit manque."""
    contexte = (
        f"Période : {chiffres['nb_factures']} facture(s), {chiffres['total_ht']} € HT au total "
        f"({chiffres['ht_prestations']} € de prestations, {chiffres['ht_ventes']} € de ventes).\n"
        f"Catégorie fiscale : {chiffres['categorie']}. Régime recommandé : "
        f"{chiffres.get('regime_recommande', 'non déterminé')}.\n"
        f"Seuil applicable : {chiffres['seuil_effectif']} € — position actuelle : "
        f"{chiffres['ratio_legal'] * 100:.0f} % du seuil.\n"
        f"Cotisations sociales estimées sur la période : {chiffres['cotisations_estimees']} € "
        f"(taux {chiffres['cotisations_taux'] * 100:.1f} %, {chiffres['cotisations_libelle']}).\n"
        f"Objectif déclaré par l'utilisateur : {objectif or 'non renseigné'}.\n"
        f"Signaux à vérifier (le cas échéant, reformule-les prudemment) : "
        f"{[s['label'] for s in signaux] or 'aucun'}."
    )
    try:
        return await chat_text(SYSTEME, contexte, temperature=0.2, max_tokens=350)
    except Exception as exc:  # noqa: BLE001 — le rapport reste utilisable sans appréciation
        logger.warning("Appréciation du rapport indisponible : %s", exc)
        return _REPLI.format(n=chiffres["nb_factures"], total=chiffres["total_ht"])
