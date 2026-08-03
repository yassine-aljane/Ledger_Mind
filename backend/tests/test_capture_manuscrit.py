"""Lecture manuscrite : documents écrits à la main, ou imprimés puis remplis.

Le risque propre au manuscrit n'est pas de ne rien lire — la reconnaissance
rend presque toujours quelque chose — mais de lire FAUX en silence. Un `7` pris
pour un `1` sur un montant passerait inaperçu avec le seul contrôle des champs
absents.

Couvre ce que l'intégration doit préserver :
  • un champ LU mais douteux rejoint la file du HITL, au même titre qu'un champ
    absent, sans jamais être retenu sans accord humain ;
  • la question posée diffère : on CONFIRME une valeur lue, on ne la ressaisit
    pas à l'aveugle — et la valeur lue est proposée en premier ;
  • les clés de lecture (`_writing_mode`, `_uncertain`) décrivent la lecture et
    non le document : elles sont retirées avant validation du modèle métier ;
  • un nom de champ inventé par le modèle est ignoré ;
  • le mode d'écriture est conservé en base, pour que l'origine d'une valeur
    reste connue après coup.

`mongomock` remplace MongoDB ; aucun appel LLM ni réseau.
"""

from __future__ import annotations

import base64

import mongomock
import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.errors import GraphInterrupt
from langgraph.types import Command

from app.agents.capture.app import prompts
from app.agents.capture.app.db import Database
from app.agents.capture.app.graph import build_graph
from app.agents.capture.app.nodes import Deps, _pop_reading_hints, _question_hitl
from app.agents.capture.app.schemas import Invoice


# -- Récolte des indices de lecture ------------------------------------------
def test_les_cles_de_lecture_sont_retirees_du_json_metier():
    data = {
        "invoice_number": "F-12",
        "total_ttc": 1500.0,
        "_writing_mode": "mixte",
        "_uncertain": ["total_ttc"],
    }
    lecture = _pop_reading_hints(data, Invoice.model_fields)

    assert lecture == {"writing_mode": "mixte", "uncertain_fields": ["total_ttc"]}
    # Le dict est nettoyé : le modèle Pydantic rejetterait ces clés.
    assert "_writing_mode" not in data and "_uncertain" not in data
    assert data["invoice_number"] == "F-12"


def test_un_champ_invente_par_le_modele_est_ignore():
    data = {"_uncertain": ["total_ttc", "champ_imaginaire", 42, None]}
    lecture = _pop_reading_hints(data, Invoice.model_fields)
    assert lecture["uncertain_fields"] == ["total_ttc"]


@pytest.mark.parametrize("mode", ["imprime", "manuscrit", "mixte"])
def test_modes_d_ecriture_reconnus(mode):
    assert _pop_reading_hints({"_writing_mode": mode}, Invoice.model_fields)["writing_mode"] == mode


@pytest.mark.parametrize("mode", ["", None, "brouillon", "handwritten"])
def test_mode_d_ecriture_inattendu_est_ecarte(mode):
    assert _pop_reading_hints({"_writing_mode": mode}, Invoice.model_fields)["writing_mode"] is None


def test_donnee_non_exploitable():
    assert _pop_reading_hints("pas un dict", Invoice.model_fields) == {
        "writing_mode": None,
        "uncertain_fields": [],
    }


# -- Formulation du HITL -----------------------------------------------------
def test_champ_absent_demande_une_saisie():
    state = {"uncertain_fields": []}
    question, candidats, type_demande = _question_hitl(
        state, "total_ttc", {"total_ttc": None}, ["120"]
    )

    assert type_demande == "champ_manquant"
    assert "n'ai pas pu lire" in question
    assert candidats == ["120"]


def test_champ_douteux_demande_une_confirmation_avec_la_valeur_lue_en_tete():
    state = {"uncertain_fields": ["total_ttc"]}
    question, candidats, type_demande = _question_hitl(
        state, "total_ttc", {"total_ttc": 1500.0}, ["7500", "1500.0"]
    )

    assert type_demande == "champ_a_confirmer"
    assert "1500.0" in question, "la valeur lue doit apparaître dans la question"
    assert "doute" in question
    # La lecture arrive en tête, et n'est pas dupliquée par les suggestions.
    assert candidats[0] == "1500.0"
    assert candidats.count("1500.0") == 1
    assert "7500" in candidats


def test_un_champ_douteux_mais_vide_reste_une_saisie():
    """Sans valeur lue, il n'y a rien à confirmer : on retombe sur la saisie."""
    state = {"uncertain_fields": ["total_ttc"]}
    _, _, type_demande = _question_hitl(state, "total_ttc", {"total_ttc": None}, [])
    assert type_demande == "champ_manquant"


def test_la_note_de_lecture_n_est_ajoutee_que_pour_du_manuscrit():
    assert prompts.lecture_note("imprime") == ""
    assert prompts.lecture_note(None) == ""
    note = prompts.lecture_note("manuscrit", ["total_ttc"])
    assert "manuscrit" in note and "total_ttc" in note


# -- Parcours complet --------------------------------------------------------
class _FakeMistral:
    """Doublure du LLM : facture manuscrite dont le total est douteux."""

    def __init__(self, extraction: dict):
        self.extraction = extraction
        # Contexte reçu par l'analyse, relu par les tests.
        self.analysis_user: str | None = None

    def ocr(self, data: bytes, mime: str) -> str:
        return "FACTURE\nTotal TTC 1500\n(manuscrit)"

    def chat_json(self, model, system, user, *, temperature=0.0, fallback_model=None):
        if "détecteur de langue" in system:
            return {"language": "fr"}
        if "NATURE d'un document" in system:
            return {"type": "facture"}
        if "extracteur d'informations" in system:
            return dict(self.extraction)
        if "CANDIDATES" in system:
            return {"total_ttc": ["7500"]}
        if "classes la nature" in system:   # classification : chat_json, pas chat_text
            return {"category": "services"}
        raise AssertionError(f"Prompt chat_json inattendu : {system[:70]!r}")

    def chat_text(self, model, system, user, *, temperature=0.0, fallback_model=None):
        if "COURTE ANALYSE" in system:
            self.analysis_user = user
            return "Dépense manuscrite, montants à relire."
        raise AssertionError(f"Prompt chat_text inattendu : {system[:70]!r}")


EXTRACTION_MANUSCRITE = {
    "invoice_number": "F-2026-77",
    "issuer_name": "Atelier Bois",
    "issue_date": "2026-03-04",
    "total_ttc": 1500.0,
    "currency": "EUR",
    "_writing_mode": "manuscrit",
    "_uncertain": ["total_ttc"],
}


def _graphe(mistral):
    db = Database(mongomock.MongoClient(), "testdb")
    db.ensure_indexes()
    deps = Deps(mistral=mistral, db=db)
    return build_graph(deps, MemorySaver()), deps


def _lancer(graph, thread):
    config = {"configurable": {"thread_id": thread}}
    payload = {
        "user_id": "u-ms",
        "document_id": "doc-ms",
        "filename": "facture-manuscrite.jpg",
        "mime": "image/jpeg",
        "file_b64": base64.b64encode(b"image").decode("ascii"),
        "messages": [],
    }
    try:
        graph.invoke(payload, config)
    except GraphInterrupt:
        pass
    return config


def _etat(graph, config):
    snap = graph.get_state(config)
    return (snap.values or {}), [i for t in snap.tasks for i in (getattr(t, "interrupts", None) or [])]


def test_un_total_douteux_est_soumis_a_confirmation_puis_corrige():
    mistral = _FakeMistral(dict(EXTRACTION_MANUSCRITE))
    graph, deps = _graphe(mistral)
    config = _lancer(graph, "t-manuscrit")

    values, interruptions = _etat(graph, config)
    assert interruptions, "un champ douteux doit interrompre le parcours"
    demande = interruptions[0].value
    assert demande["type"] == "champ_a_confirmer"
    assert demande["field"] == "total_ttc"
    assert demande["suggestions"][0] == "1500.0"
    assert deps.db.list_invoices("u-ms") == [], "rien avant la réponse humaine"

    # L'utilisateur corrige : le 1 était un 7.
    try:
        graph.invoke(Command(resume="7500"), config)
    except GraphInterrupt:
        pass

    values, interruptions = _etat(graph, config)
    assert not interruptions
    assert values["saved"] is True
    enregistre = deps.db.list_invoices("u-ms")[0]
    assert enregistre["invoice"]["total_ttc"] == 7500.0, "la correction humaine fait autorité"
    # L'analyse rédigée doit savoir qu'elle commente une lecture manuscrite.
    assert "LECTURE : document entièrement manuscrit" in mistral.analysis_user


def test_le_mode_d_ecriture_est_conserve_en_base():
    graph, deps = _graphe(_FakeMistral(dict(EXTRACTION_MANUSCRITE)))
    config = _lancer(graph, "t-manuscrit-2")
    try:
        graph.invoke(Command(resume="passer"), config)
    except GraphInterrupt:
        pass

    enregistre = deps.db.list_invoices("u-ms")[0]
    assert enregistre["writing_mode"] == "manuscrit"
    assert enregistre["uncertain_fields"] == ["total_ttc"]
    # « passer » conserve la lecture d'origine plutôt que de l'effacer.
    assert enregistre["invoice"]["total_ttc"] == 1500.0


def test_un_document_imprime_ne_declenche_aucune_confirmation():
    imprime = dict(EXTRACTION_MANUSCRITE, _writing_mode="imprime", _uncertain=[])
    mistral = _FakeMistral(imprime)
    graph, deps = _graphe(mistral)
    config = _lancer(graph, "t-imprime")

    values, interruptions = _etat(graph, config)
    assert not interruptions
    assert values["saved"] is True
    assert deps.db.list_invoices("u-ms")[0]["writing_mode"] == "imprime"
    # Aucune note de lecture ne doit polluer l'analyse d'un document imprimé.
    assert "LECTURE" not in mistral.analysis_user
