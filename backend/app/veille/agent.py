"""Agent de veille fiscale personnalisée.

Un cycle se déroule en trois temps, strictement séparés :

  1. COLLECTE     — interroge les sources via MCP (réutilise `scheduler._collecter`)
  2. QUALIFICATION — le LLM résume et extrait des CRITÈRES structurés : qui est concerné
  3. DISTRIBUTION  — confronte ces critères au profil de chaque utilisateur, sans LLM

Le LLM n'intervient qu'à l'étape 2, une seule fois par nouveauté. L'affichage lit ensuite ce qui
est déjà en base : pas d'appel réseau, pas de coût, pas de variabilité d'un chargement à l'autre.
"""

from __future__ import annotations

import logging
from datetime import datetime

from app.llm import chat_json_with_system
from app.veille import store
from app.veille.modele import (
    ACTIVITES_CONNUES,
    SEUILS_CONNUS,
    Criteres,
    Nouveaute,
    NouveauteNotifiee,
    Source,
    cle_dedup,
    maintenant,
)
from app.veille.profil import ProfilVeille, construire_profil
from app.veille.scoring import evaluer, notifiable

logger = logging.getLogger(__name__)

#: Au-delà, une nouveauté est marquée périmée (jamais supprimée).
FRAICHEUR_MAX_JOURS = 180

_SYSTEME_QUALIFICATION = f"""Tu qualifies une publication fiscale ou juridique française pour \
des indépendants et créateurs de contenu.

Réponds en JSON STRICT, sans texte autour :
{{
  "pertinent": true|false,
  "titre": "une phrase claire, sans jargon",
  "resume": "2 à 3 phrases : ce qui change, et ce que la personne doit faire",
  "impact": "information"|"action_recommandee"|"action_obligatoire",
  "echeance": "AAAA-MM-JJ" ou null,
  "criteres": {{
    "regimes": [],
    "tax_categories": [],
    "regimes_tva": [],
    "seuils": [],
    "activites": [],
    "international": true|false|null
  }}
}}

RÈGLES ABSOLUES :
- pertinent=false si le texte ne concerne pas les indépendants/créateurs, s'il s'agit d'un projet \
non promulgué, ou si aucune règle applicable n'en ressort. Le silence vaut mieux que le bruit.
- N'invente AUCUN chiffre. Si un montant, un taux ou un seuil n'est pas explicitement dans le \
texte, ne le mentionne pas.
- N'écris jamais de conseil personnalisé. Tu informes, tu ne recommandes pas une stratégie.
- Une liste de critères VIDE signifie « pas de restriction » : ne remplis un critère que si le \
texte le restreint EXPLICITEMENT.
- tax_categories ∈ ["BNC","BIC","mixed"] ; regimes_tva ∈ ["franchise","reel_simplifie","reel_normal"]
- seuils ∈ {sorted(SEUILS_CONNUS)}
- activites ∈ {sorted(ACTIVITES_CONNUES)}
- international=true seulement si la mesure ne vise QUE ceux qui facturent hors de France.
"""


async def qualifier(titre: str, texte: str) -> dict | None:
    """Fait résumer et classer une publication. Renvoie None si elle n'est pas retenue."""
    try:
        brut = await chat_json_with_system(
            _SYSTEME_QUALIFICATION,
            f"Titre : {titre}\n\nTexte : {texte[:6000]}",
            temperature=0.1,
            max_tokens=700,
        )
    except Exception as exc:  # noqa: BLE001
        # Une qualification impossible n'est PAS une nouveauté sans critère : ce serait la
        # diffuser à tout le monde. On préfère la laisser de côté.
        logger.warning("Qualification impossible pour « %s » : %s", titre, exc)
        return None

    if not brut.get("pertinent", False):
        return None
    if not brut.get("resume"):
        return None
    return brut


def _construire(candidat: dict, qualif: dict, cycle_id: str) -> Nouveaute | None:
    """Assemble une nouveauté publiable, ou None si la règle de sourçage n'est pas tenue."""
    autorite = int(candidat.get("autorite", 3))
    # Règle non négociable : une nouveauté doit s'adosser à une source d'autorité 1 ou 2. La
    # presse (3) peut faire repérer un sujet, jamais l'affirmer.
    if autorite not in (1, 2):
        return None
    if not candidat.get("url"):
        return None

    titre = (qualif.get("titre") or candidat["titre"]).strip()
    echeance = qualif.get("echeance") or None
    criteres = Criteres.model_validate(qualif.get("criteres") or {}).normalise()

    return Nouveaute(
        id=cle_dedup(titre, echeance),
        titre=titre,
        resume=qualif["resume"].strip(),
        impact=qualif.get("impact") or "information",
        echeance=echeance,
        sources=[
            Source(
                libelle=candidat.get("source") or "Source officielle",
                url=candidat["url"],
                date_publication=candidat.get("date_publication"),
                autorite=autorite,  # type: ignore[arg-type]
            )
        ],
        criteres=criteres,
        date_collecte=maintenant(),
        date_verification=maintenant(),
        cycle_id=cycle_id,
    )


async def collecter_et_qualifier() -> dict:
    """Étapes 1 et 2 : remplit le catalogue. Ne notifie personne."""
    from app.veille import scheduler

    cycle_id = datetime.now().isoformat(timespec="seconds")
    candidats = await scheduler._collecter()

    nouvelles, connues, ecartees = 0, 0, 0
    for candidat in candidats:
        qualif = await qualifier(candidat["titre"], candidat.get("texte", ""))
        if qualif is None:
            ecartees += 1
            continue
        item = _construire(candidat, qualif, cycle_id)
        if item is None:
            ecartees += 1
            continue
        if store.upsert_nouveaute(item):
            nouvelles += 1
        else:
            connues += 1

    perimees = store.marquer_perimees(FRAICHEUR_MAX_JOURS)
    logger.info(
        "Veille — cycle %s : %d nouvelle(s), %d connue(s), %d écartée(s), %d périmée(s)",
        cycle_id, nouvelles, connues, ecartees, perimees,
    )
    return {
        "cycle_id": cycle_id,
        "nouvelles": nouvelles,
        "connues": connues,
        "ecartees": ecartees,
        "perimees": perimees,
    }


def distribuer(profil: ProfilVeille) -> dict:
    """Étape 3 : confronte le catalogue à un profil et enregistre les notifications dues.

    Purement déterministe et sans réseau : appelable depuis une requête HTTP sans coût.
    """
    prefs = store.get_preferences(profil.uid)
    if not prefs.active:
        return {"notifiees": 0, "raison": "veille désactivée"}
    if profil.est_vide:
        # Aucun champ discriminant : notifier reviendrait à envoyer de la veille générique.
        return {"notifiees": 0, "raison": "profil trop incomplet"}

    quota = store.MAX_NOTIFS_PAR_SEMAINE - store.compte_semaine(profil.uid)
    if quota <= 0:
        return {"notifiees": 0, "raison": "plafond hebdomadaire atteint"}

    connues = store.deja_notifiees(profil.uid)
    candidates = []
    for nouveaute in store.nouveautes_actives():
        if nouveaute.id in connues or nouveaute.perime:
            continue
        verdict = evaluer(nouveaute, profil)
        if notifiable(verdict, nouveaute, prefs.mode):
            candidates.append((nouveaute, verdict))

    # Les actions obligatoires passent devant, puis le score : sous plafond, ce qui contraint
    # doit sortir avant ce qui informe.
    ordre = {"action_obligatoire": 0, "action_recommandee": 1, "information": 2}
    candidates.sort(key=lambda c: (ordre.get(c[0].impact, 3), -c[1].score))

    notifiees = 0
    for nouveaute, verdict in candidates[:quota]:
        ok = store.enregistrer_notification(
            NouveauteNotifiee(
                uid=profil.uid,
                nouveaute_id=nouveaute.id,
                pertinence=round(verdict.score, 2),
                pourquoi_vous=verdict.pourquoi_vous,
                champs_profil_declencheurs=verdict.champs_declencheurs,
                date_notifiee=maintenant(),
            )
        )
        if ok:
            notifiees += 1

    return {"notifiees": notifiees, "candidates": len(candidates), "quota": quota}


def pour_utilisateur(user, profil_guidance: dict | None = None, inclure_contexte: bool = True) -> list[dict]:
    """Le fil de veille d'un utilisateur : nouveautés retenues, la plus pertinente d'abord.

    `inclure_contexte=False` restreint aux seules nouveautés assez fortes pour être notifiées.
    """
    profil = construire_profil(user, profil_guidance)
    distribuer(profil)  # rattrape les nouveautés arrivées depuis la dernière visite

    prefs = store.get_preferences(profil.uid)
    lues = {n["nouveaute_id"]: n for n in store.notifications_de(profil.uid, limite=200)}

    fil = []
    for nouveaute in store.nouveautes_actives():
        verdict = evaluer(nouveaute, profil)
        if not verdict.retenue:
            continue
        if not inclure_contexte and not notifiable(verdict, nouveaute, prefs.mode):
            continue
        notif = lues.get(nouveaute.id)
        fil.append(
            {
                **nouveaute.model_dump(),
                "pertinence": round(verdict.score, 2),
                "pourquoi_vous": verdict.pourquoi_vous,
                "champs_profil_declencheurs": verdict.champs_declencheurs,
                "notifiee": notif is not None,
                "lue": bool(notif and notif.get("lue")),
            }
        )

    ordre = {"action_obligatoire": 0, "action_recommandee": 1, "information": 2}
    fil.sort(key=lambda n: (ordre.get(n["impact"], 3), -n["pertinence"]))
    return fil


async def run_cycle() -> dict:
    """Un cycle complet, planifié : collecte et qualification. La distribution se fait à la
    lecture, pour rester juste même si le profil de l'utilisateur a changé entre-temps."""
    return await collecter_et_qualifier()
