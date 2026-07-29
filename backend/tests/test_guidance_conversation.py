"""Parcours conversationnel de l'espace « pas encore immatriculé » (branche sans SIREN).

Couvre ce que l'intégration doit préserver :
  • le profil se construit AU FIL de la conversation (aucun formulaire) et est partagé par uid ;
  • la feuille de route n'est JAMAIS produite tant qu'une information légale manque ;
  • les cadeaux sont une rémunération EN NATURE (prestations), jamais une vente ;
  • l'anti-boucle : une question sans réponse exploitable applique une hypothèse prudente ;
  • la mémoire (conversations, messages, cases cochées) persiste dans MongoDB.

MongoDB est simulé par `mongomock` : aucun serveur n'est nécessaire pour ces tests.
"""

from __future__ import annotations

import asyncio

import mongomock
import pytest

from app.agents.guidance import conversation as C
from app.core import conversation_store as store

UID = "test-uid"


@pytest.fixture(autouse=True)
def mongo(monkeypatch):
    """Base en mémoire, remise à zéro entre les tests."""
    client = mongomock.MongoClient()
    monkeypatch.setattr(store, "get_db", lambda: client["ledgermind_test"])
    monkeypatch.setattr(store, "_initialized", False)
    yield
    monkeypatch.setattr(store, "_initialized", False)


@pytest.fixture
def llm_muet(monkeypatch):
    """Neutralise les appels LLM : l'extraction ne renvoie rien, la rédaction est fixe.

    Les tests portent alors uniquement sur la logique DÉTERMINISTE (ce que le code décide).
    """
    async def _rien(message, profil):
        return {}

    async def _accompagnement(message, profil=None):
        from app.agents.guidance.roadmap.parcours import build_roadmap
        roadmap = build_roadmap(profil or {}) if profil else None
        return {"reponse": "Voici ta feuille de route.", "roadmap": roadmap, "sources": []}

    monkeypatch.setattr(C, "extraire_profil", _rien)
    monkeypatch.setattr(C, "guidance_chat", _accompagnement)


def _run(coro):
    return asyncio.run(coro)


# --------------------------------------------------------------------------- Mémoire (MongoDB)
def test_conversation_et_messages_persistes():
    sid = store.ensure_session(None, uid=UID, type="guidance")
    store.add_message(sid, "user", "Je débute sur Instagram")
    store.add_message(sid, "assistant", "Quelle est ton activité ?", [])

    messages = store.history(sid)
    assert [m["role"] for m in messages] == ["user", "assistant"]
    # Titre automatique dérivé du premier message utilisateur, sans appel LLM.
    assert store.session_meta(sid)["title"] == "Je débute sur Instagram"


def test_historique_filtre_par_interface():
    store.ensure_session(None, uid=UID, type="guidance")
    store.ensure_session(None, uid=UID, type="pedagogue")
    assert len(store.list_sessions(UID)) == 2
    assert len(store.list_sessions(UID, "guidance")) == 1


def test_profil_partage_par_uid_entre_conversations():
    sid1 = store.ensure_session(None, uid=UID, type="guidance")
    store.patch_profil(UID, {"activite": "création de contenu"})
    sid2 = store.ensure_session(None, uid=UID, type="pedagogue")
    assert store.get_profil_by_session(sid2)["activite"] == "création de contenu"
    assert store.get_profil_by_session(sid1)["activite"] == "création de contenu"


def test_ca_total_recalcule_depuis_les_composantes():
    store.patch_profil(UID, {"ca_prestations": 30000.0, "ca_vente": 12000.0})
    assert store.get_profil(UID)["ca_estime"] == 42000.0


def test_effacement_dun_champ_de_la_fiche():
    store.patch_profil(UID, {"activite": "photographie"})
    assert store.clear_profil_field(UID, "activite") == {}


def test_cases_cochees_persistees_avec_la_conversation():
    sid = store.ensure_session(None, uid=UID)
    store.save_roadmap(sid, roadmap={"parcours": "micro"}, checked={"etape-1": True})
    etat = store.get_roadmap(sid)
    assert etat["roadmap"]["parcours"] == "micro"
    assert etat["checked"] == {"etape-1": True}


def test_suppression_efface_messages_et_roadmap():
    sid = store.ensure_session(None, uid=UID)
    store.add_message(sid, "user", "bonjour")
    store.save_roadmap(sid, roadmap={"parcours": "micro"})
    assert store.delete_session(sid) is True
    assert store.history(sid) == []
    assert store.get_roadmap(sid) is None
    assert store.delete_session(sid) is False


# ------------------------------------------------------------- Profilage conversationnel (code)
def test_aucune_roadmap_tant_quil_manque_une_information(llm_muet):
    out = _run(C.respond(None, "Je fais des vidéos YouTube", uid=UID))
    assert out["roadmap"] is None
    assert out["profil_complet"] is False
    assert "activité principale" in out["reponse"]
    # Des réponses rapides accompagnent la question courante.
    assert out["suggestions"]


def test_roadmap_generee_des_que_le_profil_est_complet(llm_muet):
    store.patch_profil(UID, {"activite": "création de contenu", "ca_estime": 45000.0,
                             "vend_produits": False})
    out = _run(C.respond(None, "Et maintenant ?", uid=UID))
    assert out["profil_complet"] is True
    assert out["roadmap"] is not None
    assert out["roadmap"]["parcours"] in {"micro", "bascule", "societe"}


def test_ventilation_requise_en_activite_mixte(llm_muet):
    store.patch_profil(UID, {"activite": "création de contenu", "ca_estime": 60000.0,
                             "vend_produits": True})
    out = _run(C.respond(None, "voilà", uid=UID))
    assert out["roadmap"] is None
    assert "répartit" in out["reponse"]


def test_devise_etrangere_bloque_la_roadmap(llm_muet):
    store.patch_profil(UID, {"activite": "streaming", "ca_estime": 30000.0,
                             "vend_produits": False, "devise": "USD"})
    out = _run(C.respond(None, "je gagne en dollars", uid=UID))
    assert out["roadmap"] is None
    assert "euros" in out["reponse"]


def test_les_cadeaux_alimentent_les_prestations_jamais_les_ventes():
    maj = C._reconcilier({}, {"cadeaux_montant": 10000, "periode": "an"})
    assert maj["remuneration_nature"] == 10000.0
    assert maj["ca_prestations"] == 10000.0
    assert "ca_vente" not in maj


def test_montants_annualises_avec_la_periode():
    maj = C._reconcilier({}, {"ca_montant": 3000, "periode": "mois"})
    assert maj["ca_estime"] == 36000.0


def test_extraction_de_repli_sans_llm():
    out = C._extraire_profil_regex("Je fais du YouTube, environ 3000 par mois, pas de vente")
    assert out["activite"] == "YouTube"
    assert out["ca_estime"] == 36000.0
    assert out["vend_produits"] is False


def test_anti_boucle_applique_une_hypothese_prudente(monkeypatch, llm_muet):
    """La question du CA reste sans réponse exploitable : on n'insiste pas, on prend l'hypothèse
    prudente d'un démarrage sous les seuils et on l'annonce."""
    store.patch_profil(UID, {"activite": "coaching"})
    sid = store.ensure_session(None, uid=UID)
    store.add_message(sid, "assistant", "Quel chiffre d’affaires annuel prévois-tu ?", [])

    async def _ne_sait_pas(question, message):
        return {"statut": "ne_sait_pas", "valeur": None}

    monkeypatch.setattr(C, "_interpreter_reponse", _ne_sait_pas)
    out = _run(C.respond(sid, "aucune idée, je démarre", uid=UID))
    assert store.get_profil(UID)["ca_estime"] == 0.0
    assert "hypothèse prudente" in out["reponse"]


def test_choix_de_parcours_en_zone_de_bascule(llm_muet):
    """Un clic sur une option renvoyée par le backend applique le choix et régénère la roadmap."""
    store.patch_profil(UID, {"activite": "conseil", "ca_estime": 85000.0, "vend_produits": False})
    sid = store.ensure_session(None, uid=UID)
    out = _run(C.respond(sid, "Je pars sur la micro-entreprise",
                         action={"kind": "choix_parcours", "value": "micro"}, uid=UID))
    assert store.get_profil(UID)["choix_parcours"] == "micro"
    assert out["roadmap"] is not None


# --------------------------------------------------- Repli déterministe d'extraction du montant
# Ce repli est le SEUL recours quand le LLM est indisponible (quota dépassé, panne réseau).
# S'il ne reconnaît pas un montant, l'agent repose la même question indéfiniment sans que rien
# ne signale l'échec à l'utilisateur — le pire mode de dégradation possible.
@pytest.mark.parametrize("message, attendu", [
    # Le cas qui bouclait : une description s'intercale entre « ca » et le montant.
    ("j'ai un ca global en tant qu'instagrammeuse d'environ 200 000 euros", 200000),
    ("environ 200000€", 200000),
    ("mon ca : 45000", 45000),
    ("je fais 200k", 200000),
    # Les montants périodiques restent annualisés.
    ("1 500 € par mois", 18000),
    ("3k/mois", 36000),
])
def test_montant_reconnu_par_le_repli(message, attendu):
    assert C._ca_annuel(message.lower()) == attendu


@pytest.mark.parametrize("message", [
    "je débute, presque rien",
    "je fais 200 km de vélo",      # « k » ne doit pas être lu comme un millier
    "200 kg de matériel",
])
def test_repli_ne_devine_pas_de_montant(message):
    assert C._ca_annuel(message.lower()) is None
