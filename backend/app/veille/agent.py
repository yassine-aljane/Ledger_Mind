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
from datetime import datetime, timedelta

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
from app.veille.scoring import est_universelle, evaluer, notifiable

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
  "nature": "actualite"|"reference",
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


#: Motifs de titres à écarter AVANT toute qualification.
#:
#: La recherche Légifrance interroge le JORF en « un des mots » : un texte contenant simplement
#: « commerciale » ou « non » ressort, si bien qu'un cycle réel remonte surtout des avis de
#: vacance d'emploi et des nominations. Les filtrer ici évite de dépenser un appel LLM par
#: document pour s'entendre répondre « pertinent: false » — sur un cycle observé, 15 candidats
#: sur 22 étaient de ce type.
_MOTIFS_BRUIT = (
    "avis de vacance",
    "vacance d'un emploi",
    "vacance de l'emploi",
    "vacance d'emploi",
    "nomination",
    "portant nomination",
    "cessation de fonctions",
    "tableau d'avancement",
    "liste d'aptitude",
    "medaille",
    "légion d'honneur",
    "ordre national du merite",
)


def est_bruit(titre: str) -> bool:
    """Vrai pour les publications administratives sans portée fiscale."""
    bas = titre.lower()
    return any(motif in bas for motif in _MOTIFS_BRUIT)


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
        nature=qualif.get("nature") or "reference",
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


# --------------------------------------------------------------------- Sources d'actualité

#: Pages d'ACTUALITÉ officielles, distinctes des pages de référence du corpus.
#:
#: Une page de référence décrit une règle qui ne bouge pas ; une page d'actualité annonce ce qui
#: change. La veille n'a d'intérêt que sur les secondes — c'est ce que montrait le premier cycle
#: réel : 18 candidats sur 19 étaient de la documentation permanente.
SOURCES_ACTUALITE: tuple[dict, ...] = (
    {"url": "https://www.impots.gouv.fr/actualites", "libelle": "DGFiP — Actualités", "autorite": 2},
    {"url": "https://www.impots.gouv.fr/professionnel/actualites", "libelle": "DGFiP — Actualités professionnels", "autorite": 2},
    {"url": "https://www.urssaf.fr/accueil/actualites.html", "libelle": "URSSAF — Actualités", "autorite": 2},
    {"url": "https://boss.gouv.fr/portail/accueil/nouveautes.html", "libelle": "BOSS — Nouveautés", "autorite": 2},
    {"url": "https://www.economie.gouv.fr/loi-finances-2026", "libelle": "Loi de finances 2026", "autorite": 1},
)

#: Nombre maximal de nouveautés extraites d'une même page. Une page d'actualités en liste
#: souvent une vingtaine ; au-delà des plus récentes, on remonte dans des mois écoulés.
MAX_PAR_PAGE = 6

_SYSTEME_LOT = f"""Tu dépouilles une page d'ACTUALITÉS fiscales ou sociales françaises, destinée à des indépendants et créateurs de contenu.

La page liste plusieurs annonces. Extrais-en AU PLUS {MAX_PAR_PAGE}, les plus récentes et les plus utiles. Réponds en JSON STRICT :
{{"nouveautes": [{{
  "titre": "une phrase claire, sans jargon",
  "resume": "2 à 3 phrases : ce qui change, et ce que la personne doit faire",
  "impact": "information"|"action_recommandee"|"action_obligatoire",
  "nature": "actualite"|"reference",
  "echeance": "AAAA-MM-JJ" ou null,
  "criteres": {{"regimes": [], "tax_categories": [], "regimes_tva": [], "seuils": [],
                "activites": [], "international": true|false|null}}
}}]}}

RÈGLES ABSOLUES :
- N'extrais QUE ce qui est écrit sur la page. N'invente ni titre, ni chiffre, ni date.
- N'extrais que ce qui concerne les indépendants/créateurs. Si rien ne les concerne, renvoie {{"nouveautes": []}} — une liste vide est une réponse correcte.
- nature="actualite" seulement pour un fait NOUVEAU et daté. "reference" pour une page permanente. Dans le doute : "reference".
- echeance : uniquement une date FUTURE explicitement imposée. Jamais une date passée.
- Ne donne aucun conseil personnalisé : tu informes, tu ne recommandes pas de stratégie.
- tax_categories ∈ ["BNC","BIC","mixed"] ; regimes_tva ∈ ["franchise","reel_simplifie","reel_normal"]
- seuils ∈ {sorted(SEUILS_CONNUS)} ; activites ∈ {sorted(ACTIVITES_CONNUES)}
"""


async def qualifier_lot(titre: str, texte: str) -> list[dict]:
    """Extrait plusieurs nouveautés d'une page d'actualités.

    C'est la différence décisive avec `qualifier` : une page listant vingt annonces ne doit pas
    produire une seule entrée fourre-tout. Une liste vide est un résultat acceptable.
    """
    try:
        brut = await chat_json_with_system(
            _SYSTEME_LOT,
            f"Page : {titre}\n\nContenu : {texte[:12000]}",
            temperature=0.1,
            max_tokens=2000,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Dépouillement impossible pour « %s » : %s", titre, exc)
        return []

    items = brut.get("nouveautes") or []
    if not isinstance(items, list):
        return []
    return [i for i in items[:MAX_PAR_PAGE] if isinstance(i, dict) and i.get("resume")]


async def _collecter_actualites() -> list[tuple[dict, list[dict]]]:
    """Interroge les pages d'actualité et en dépouille les annonces.

    Chaque annonce garde l'URL de la PAGE comme source : on ne peut pas vérifier une URL d'article
    reconstituée par un modèle, et une source fausse serait pire qu'une source imprécise.
    """
    from app.mcp import client as mcp

    resultats: list[tuple[dict, list[dict]]] = []
    for source in SOURCES_ACTUALITE:
        try:
            page = await mcp.call_tool("docs-officiels", "fetch_page", {"cle_ou_url": source["url"]})
        except Exception as exc:  # noqa: BLE001
            logger.warning("Source d'actualité injoignable (%s) : %s", source["url"], exc)
            continue
        texte = page.get("texte", "") if isinstance(page, dict) else ""
        if not texte:
            continue
        annonces = await qualifier_lot(source["libelle"], texte)
        if annonces:
            resultats.append((source, annonces))
    return resultats


async def collecter_et_qualifier() -> dict:
    """Étapes 1 et 2 : remplit le catalogue. Ne notifie personne."""
    from app.veille import scheduler

    cycle_id = datetime.now().isoformat(timespec="seconds")
    nouvelles, connues, ecartees = 0, 0, 0
    bruit = 0

    # 1) Pages d'actualité : plusieurs annonces par page.
    for source, annonces in await _collecter_actualites():
        for annonce in annonces:
            item = _construire(
                {"titre": annonce.get("titre", source["libelle"]), "url": source["url"],
                 "source": source["libelle"], "autorite": source["autorite"]},
                annonce, cycle_id,
            )
            if item is None or item.nature != "actualite" or item.echeance_depassee:
                ecartees += 1
                continue
            if store.upsert_nouveaute(item):
                nouvelles += 1
            else:
                connues += 1

    # 2) Sources historiques (Légifrance, BOFiP, docs officiels) : une annonce par document.
    candidats = await scheduler._collecter()
    for candidat in candidats:
        if est_bruit(candidat["titre"]):
            bruit += 1
            continue
        qualif = await qualifier(candidat["titre"], candidat.get("texte", ""))
        if qualif is None:
            ecartees += 1
            continue
        item = _construire(candidat, qualif, cycle_id)
        if item is None:
            ecartees += 1
            continue
        # Une page de référence décrit une règle inchangée : elle a sa place dans le corpus du
        # pédagogue (déjà ré-ingérée par `scheduler.run_veille`), pas dans un fil d'actualité.
        if item.nature != "actualite":
            ecartees += 1
            continue
        # Une échéance déjà passée n'annonce plus rien : la publier afficherait « action
        # obligatoire avant le 15/12/2025 » huit mois après la date.
        if item.echeance_depassee:
            ecartees += 1
            continue
        if store.upsert_nouveaute(item):
            nouvelles += 1
        else:
            connues += 1

    perimees = store.marquer_perimees(FRAICHEUR_MAX_JOURS)
    logger.info(
        "Veille — cycle %s : %d nouvelle(s), %d connue(s), %d écartée(s), %d bruit, %d périmée(s)",
        cycle_id, nouvelles, connues, ecartees, bruit, perimees,
    )
    return {
        "cycle_id": cycle_id,
        "nouvelles": nouvelles,
        "connues": connues,
        "ecartees": ecartees,
        "bruit": bruit,
        "perimees": perimees,
    }


# ------------------------------------------------------------------ Amorçage du catalogue

#: Au-delà, on retente une collecte au premier accès. Le planificateur (`start_scheduler`) ne
#: passe qu'une fois par jour à heure fixe : un serveur redémarré dans la journée — le cas normal
#: en développement — ne collecte jamais, et le catalogue reste figé sur ce qu'un lancement
#: manuel avait produit. D'où cet amorçage paresseux, qui rend l'écran vivant sans planificateur.
DELAI_RAFRAICHISSEMENT_H = 12

#: Verrou de processus : deux requêtes simultanées ne doivent pas lancer deux collectes.
_collecte_en_cours = False
#: Dernière TENTATIVE (réussie ou non). Sans elle, un MCP indisponible ferait retenter à chaque
#: appel — donc à chaque sondage de la cloche, toutes les cinq minutes.
_derniere_tentative: datetime | None = None


def catalogue_a_rafraichir() -> bool:
    """Vrai si le catalogue est vide ou trop ancien, et qu'aucune collecte n'est en cours."""
    if _collecte_en_cours:
        return False
    limite = datetime.now() - timedelta(hours=DELAI_RAFRAICHISSEMENT_H)
    if _derniere_tentative and _derniere_tentative > limite:
        return False
    stats = store.stats_catalogue()
    if stats["actualites"] == 0:
        return True
    derniere = stats["derniere_collecte"]
    return not derniere or derniere < limite.isoformat(timespec="seconds")


async def assurer_catalogue() -> dict | None:
    """Collecte si nécessaire. Conçue pour être appelée en tâche de fond, jamais attendue.

    Une exception ici ne doit rien casser : la veille reste consultable avec ce qu'elle a déjà.
    """
    global _collecte_en_cours, _derniere_tentative
    if not catalogue_a_rafraichir():
        return None
    _collecte_en_cours = True
    _derniere_tentative = datetime.now()
    try:
        return await collecter_et_qualifier()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Amorçage du catalogue de veille impossible : %s", exc)
        return None
    finally:
        _collecte_en_cours = False


def distribuer(profil: ProfilVeille) -> dict:
    """Étape 3 : confronte le catalogue à un profil et enregistre les notifications dues.

    Purement déterministe et sans réseau : appelable depuis une requête HTTP sans coût.
    """
    prefs = store.get_preferences(profil.uid)
    if not prefs.active:
        return {"notifiees": 0, "raison": "veille désactivée"}
    # Un profil sans champ discriminant ne permet aucun rattachement fin — mais il ne prive
    # pas des obligations qui s'imposent à tous. On restreint alors aux mesures universelles
    # plutôt que de ne rien notifier : ne rien dire d'une échéance obligatoire est pire qu'en
    # dire trop.
    universelles_seulement = profil.est_vide

    quota = store.MAX_NOTIFS_PAR_SEMAINE - store.compte_semaine(profil.uid)
    if quota <= 0:
        return {"notifiees": 0, "raison": "plafond hebdomadaire atteint"}

    connues = store.deja_notifiees(profil.uid)
    candidates = []
    for nouveaute in store.nouveautes_actives():
        if nouveaute.id in connues or nouveaute.perime:
            continue
        if nouveaute.echeance_depassee or nouveaute.nature != "actualite":
            continue
        if universelles_seulement and not est_universelle(nouveaute):
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
        # Le catalogue vieillit entre deux cycles : une échéance franchie hier ne doit plus
        # s'afficher aujourd'hui, même si la nouveauté était parfaitement valable à la collecte.
        if nouveaute.echeance_depassee or nouveaute.nature != "actualite":
            continue
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
                # La date de notification est la SEULE marque durable de nouveauté : l'état
                # « non lu » s'éteint dès la première ouverture du panneau, si bien qu'en
                # rouvrant trente secondes plus tard, plus rien ne distinguerait ce qui vient
                # d'arriver de ce qui traîne depuis un mois.
                "date_notifiee": (notif or {}).get("date_notifiee"),
            }
        )

    # Tri : ce qui contraint d'abord, puis l'échéance la plus proche, puis la pertinence.
    # Une obligation qui tombe dans huit jours doit précéder une obligation sans date.
    ordre = {"action_obligatoire": 0, "action_recommandee": 1, "information": 2}
    fil.sort(
        key=lambda n: (
            ordre.get(n["impact"], 3),
            n["echeance"] or "9999-12-31",
            -n["pertinence"],
        )
    )
    return fil


async def run_cycle() -> dict:
    """Un cycle complet, planifié : collecte et qualification. La distribution se fait à la
    lecture, pour rester juste même si le profil de l'utilisateur a changé entre-temps."""
    global _derniere_tentative
    _derniere_tentative = datetime.now()
    return await collecter_et_qualifier()
