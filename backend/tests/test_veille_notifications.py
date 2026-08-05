"""Le cycle de vie d'une notification de veille, sur une base réelle (mongomock).

Ces tests couvrent ce que les tests de scoring ne pouvaient pas voir : le scoring était juste,
mais la notification n'atteignait jamais l'utilisateur. Le défaut constaté à l'écran — la cloche
qui reste muette sur un compte fraîchement créé — ne tenait pas à une règle de pertinence, il
tenait au fait que PERSONNE n'écrivait jamais la ligne de notification avant que la cloche ne la
lise. C'est une propriété de bout en bout, et elle se teste ici.
"""

from __future__ import annotations

import mongomock
import pytest

from app.veille import agent, store
from app.veille.modele import Criteres, Nouveaute, NouveauteNotifiee, Source, maintenant
from app.veille.profil import ProfilVeille


@pytest.fixture(autouse=True)
def mongo(monkeypatch):
    client = mongomock.MongoClient()
    monkeypatch.setattr(store, "get_db", lambda: client["ledgermind_test"])
    # `ensure_schema` ne pose ses index qu'une fois par processus : sans cette remise à zéro, le
    # deuxième test travaillerait sur une base neuve dépourvue de la contrainte d'unicité qui
    # garantit la non-renotification.
    monkeypatch.setattr(store, "_initialized", False)
    yield


def _nouveaute(id_: str = "n1", **kwargs) -> Nouveaute:
    base = dict(
        id=id_,
        titre="La facturation électronique devient obligatoire",
        resume="Toutes les entreprises devront émettre leurs factures au format électronique.",
        impact="action_obligatoire",
        nature="actualite",
        echeance=None,
        sources=[Source(libelle="DGFiP", url="https://impots.gouv.fr/a", autorite=1)],
        criteres=Criteres(),
        date_collecte=maintenant(),
        date_verification=maintenant(),
    )
    base.update(kwargs)
    return Nouveaute(**base)


# ------------------------------------------------------- Le compte neuf reçoit ses notifications


def test_un_compte_neuf_recoit_les_obligations_universelles():
    """Le cœur du défaut : un utilisateur créé APRÈS la collecte n'avait aucune ligne de
    notification, et la cloche interrogeait donc une table vide."""
    store.upsert_nouveaute(_nouveaute())
    profil = ProfilVeille(uid="nouveau-compte")

    assert store.notifications_de("nouveau-compte") == []
    resultat = agent.distribuer(profil)

    assert resultat["notifiees"] == 1
    notifs = store.notifications_de("nouveau-compte")
    assert len(notifs) == 1
    assert notifs[0]["lue"] is False


def test_distribuer_est_idempotent():
    """La distribution est désormais appelée à chaque sondage de la cloche — toutes les cinq
    minutes. Elle ne doit jamais produire de doublon ni ressusciter une notification lue."""
    store.upsert_nouveaute(_nouveaute())
    profil = ProfilVeille(uid="u1")

    assert agent.distribuer(profil)["notifiees"] == 1
    store.marquer_tout_lu("u1")
    for _ in range(3):
        assert agent.distribuer(profil)["notifiees"] == 0

    notifs = store.notifications_de("u1")
    assert len(notifs) == 1
    assert notifs[0]["lue"] is True


def test_une_nouveaute_arrivee_apres_coup_est_notifiee():
    """Le compteur doit remonter quand la collecte trouve quelque chose, sans quoi la veille
    n'est qu'un écran qu'on consulte — pas une alerte."""
    profil = ProfilVeille(uid="u1")
    store.upsert_nouveaute(_nouveaute("n1"))
    agent.distribuer(profil)
    store.marquer_tout_lu("u1")

    store.upsert_nouveaute(_nouveaute("n2", titre="Nouveau barème URSSAF au 1er janvier"))
    assert agent.distribuer(profil)["notifiees"] == 1
    assert len(store.notifications_de("u1", non_lues_seulement=True)) == 1


def test_la_veille_suspendue_ne_notifie_rien():
    store.upsert_nouveaute(_nouveaute())
    store.set_preferences("u1", active=False)
    assert agent.distribuer(ProfilVeille(uid="u1"))["notifiees"] == 0


# ------------------------------------------------------------------------ Extinction ciblée


def test_marquer_lu_ne_touche_que_les_identifiants_fournis():
    """Ouvrir le panneau en mode « obligations seules » ne doit pas éteindre le compteur
    d'informations que l'écran n'a jamais montrées."""
    for i in (1, 2, 3):
        store.enregistrer_notification(
            NouveauteNotifiee(
                uid="u1", nouveaute_id=f"n{i}", pertinence=5.0,
                pourquoi_vous="…", date_notifiee=maintenant(),
            )
        )

    assert store.marquer_tout_lu("u1", ["n1", "n3"]) == 2
    restantes = {n["nouveaute_id"] for n in store.notifications_de("u1", non_lues_seulement=True)}
    assert restantes == {"n2"}


def test_marquer_lu_sans_identifiants_eteint_tout():
    """Le bouton « Tout marquer comme lu » garde son sens littéral."""
    for i in (1, 2):
        store.enregistrer_notification(
            NouveauteNotifiee(
                uid="u1", nouveaute_id=f"n{i}", pertinence=5.0,
                pourquoi_vous="…", date_notifiee=maintenant(),
            )
        )
    assert store.marquer_tout_lu("u1") == 2
    assert store.notifications_de("u1", non_lues_seulement=True) == []


def test_une_liste_vide_neteint_rien():
    """`[]` veut dire « rien d'affiché », pas « tout » — la confondre avec `None` éteindrait le
    compteur d'un écran resté vide."""
    store.enregistrer_notification(
        NouveauteNotifiee(
            uid="u1", nouveaute_id="n1", pertinence=5.0,
            pourquoi_vous="…", date_notifiee=maintenant(),
        )
    )
    assert store.marquer_tout_lu("u1", []) == 0
    assert len(store.notifications_de("u1", non_lues_seulement=True)) == 1


# -------------------------------------------------------------- Le catalogue reste vivant


def test_une_nouveaute_perimee_sort_du_catalogue_actif():
    """Sans ce filtre, le fil ne fait qu'accumuler : une publication de l'an dernier reste
    affichée indéfiniment et l'écran paraît figé alors que la collecte fonctionne."""
    store.upsert_nouveaute(_nouveaute("vieille", date_collecte="2020-01-01T00:00:00"))
    store.upsert_nouveaute(_nouveaute("fraiche"))
    assert store.marquer_perimees(max_jours=180) == 1

    actifs = {n.id for n in store.nouveautes_actives()}
    assert actifs == {"fraiche"}
    assert {n.id for n in store.nouveautes_actives(inclure_perimees=True)} == {"vieille", "fraiche"}


def test_une_nouveaute_perimee_nest_plus_notifiee():
    store.upsert_nouveaute(_nouveaute("vieille", date_collecte="2020-01-01T00:00:00"))
    store.marquer_perimees(max_jours=180)
    assert agent.distribuer(ProfilVeille(uid="u1"))["notifiees"] == 0


def test_stats_catalogue_distingue_le_vide_du_non_pertinent():
    """« Rien ne vous concerne » et « rien n'a été collecté » appellent des gestes opposés :
    un même écran vide pour les deux rendait la veille indébogable."""
    assert store.stats_catalogue() == {"total": 0, "actualites": 0, "derniere_collecte": None}

    store.upsert_nouveaute(_nouveaute())
    stats = store.stats_catalogue()
    assert stats["total"] == 1
    assert stats["actualites"] == 1
    assert stats["derniere_collecte"] is not None


def test_une_page_de_reference_ne_compte_pas_comme_actualite():
    store.upsert_nouveaute(_nouveaute("ref", nature="reference"))
    stats = store.stats_catalogue()
    assert stats["total"] == 1
    assert stats["actualites"] == 0


# ------------------------------------------------------------------ Amorçage du catalogue


def test_un_catalogue_vide_declenche_une_collecte():
    agent._derniere_tentative = None
    assert agent.catalogue_a_rafraichir() is True


def test_un_catalogue_frais_ne_declenche_rien():
    agent._derniere_tentative = None
    store.upsert_nouveaute(_nouveaute())
    assert agent.catalogue_a_rafraichir() is False


@pytest.mark.asyncio
async def test_une_source_injoignable_ne_fait_pas_retenter_a_chaque_appel(monkeypatch):
    """Sans mémoire de la dernière TENTATIVE, un MCP indisponible relancerait une collecte à
    chaque sondage de la cloche — soit toutes les cinq minutes, indéfiniment."""
    agent._derniere_tentative = None
    appels = 0

    async def echoue():
        nonlocal appels
        appels += 1
        raise RuntimeError("MCP indisponible")

    monkeypatch.setattr(agent, "collecter_et_qualifier", echoue)

    assert await agent.assurer_catalogue() is None
    assert await agent.assurer_catalogue() is None
    assert appels == 1

    agent._derniere_tentative = None


# ------------------------------------------------------------- Le fil rendu à l'utilisateur


class _FauxUser:
    """Le strict minimum que `construire_profil` lit sur un utilisateur."""

    def __init__(self, uid: str):
        self.id = uid
        self.agent_context = None


def test_le_fil_expose_la_date_de_notification():
    """C'est la seule marque DURABLE de nouveauté : l'état « non lu » s'éteint à la première
    ouverture du panneau, si bien qu'en rouvrant trente secondes plus tard, plus rien ne
    distinguerait ce qui vient d'arriver de ce qui traîne depuis un mois."""
    store.upsert_nouveaute(_nouveaute())
    fil = agent.pour_utilisateur(_FauxUser("u1"))

    assert len(fil) == 1
    assert fil[0]["notifiee"] is True
    assert fil[0]["date_notifiee"] is not None


def test_une_nouveaute_non_notifiee_na_pas_de_date():
    """Une mesure de contexte est consultable sans être une alerte : elle ne doit pas porter la
    marque visuelle du neuf."""
    store.upsert_nouveaute(_nouveaute(impact="information"))
    fil = agent.pour_utilisateur(_FauxUser("u1"))

    assert len(fil) == 1
    assert fil[0]["notifiee"] is False
    assert fil[0]["date_notifiee"] is None


def test_le_fil_ecarte_les_perimees():
    store.upsert_nouveaute(_nouveaute("vieille", date_collecte="2020-01-01T00:00:00"))
    store.marquer_perimees(max_jours=180)
    assert agent.pour_utilisateur(_FauxUser("u1")) == []
