"""Document hors périmètre : ni facture, ni virement, ni contrat.

Couvre ce que l'intégration doit préserver :
  • une pièce non reconnue est DITE telle quelle, jamais rabattue sur
    « facture » — un mauvais aiguillage produirait des montants inventés ;
  • une réponse inattendue du détecteur mène au même verdict prudent ;
  • le parcours s'arrête net : aucune extraction, aucune analyse, aucun
    enregistrement, et donc aucune pièce fantôme dans les registres ;
  • le dénouement n'est pas une erreur — rien n'a échoué, il n'y avait
    simplement rien à extraire.

`mongomock` remplace MongoDB ; aucun appel LLM ni réseau.
"""

from __future__ import annotations

import base64

import mongomock
import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.errors import GraphInterrupt

from app.agents.capture.app.db import Database
from app.agents.capture.app.graph import build_graph
from app.agents.capture.app.nodes import (
    Deps,
    detect_document_type_node,
    reject_unsupported_node,
    route_by_doc_type,
)


class _Detecteur:
    """Doublure du LLM : ne répond qu'à la détection de type."""

    def __init__(self, reponse: dict):
        self.reponse = reponse
        self.appels: list[str] = []

    def ocr(self, data: bytes, mime: str) -> str:
        return "CARTE NATIONALE D'IDENTITE\nRepublique Francaise"

    def chat_json(self, model, system, user, *, temperature=0.0, fallback_model=None):
        if "détecteur de langue" in system:
            return {"language": "fr"}
        if "NATURE d'un document" in system:
            self.appels.append("detection")
            return dict(self.reponse)
        raise AssertionError(f"Le parcours ne devait pas aller jusqu'à : {system[:70]!r}")

    def chat_text(self, model, system, user, *, temperature=0.0, fallback_model=None):
        raise AssertionError("Aucune analyse ne doit être rédigée pour un document écarté.")


def _deps(mistral) -> Deps:
    db = Database(mongomock.MongoClient(), "testdb")
    db.ensure_indexes()
    return Deps(mistral=mistral, db=db)


# -- Détection ---------------------------------------------------------------
def test_type_autre_est_conserve_avec_sa_nature():
    deps = _deps(_Detecteur({"type": "autre", "nature": "carte d'identité"}))
    out = detect_document_type_node({"ocr_text": "..."}, deps)

    assert out["document_type"] == "autre"
    assert out["detected_nature"] == "carte d'identité"


@pytest.mark.parametrize(
    "reponse",
    [
        {"type": "bulletin de paie"},   # catégorie inventée par le modèle
        {"type": ""},
        {},                             # champ absent
        {"type": None},
    ],
)
def test_reponse_inattendue_ne_retombe_plus_sur_facture(reponse):
    """Le repli historique sur « facture » produisait une extraction fausse."""
    deps = _deps(_Detecteur(reponse))
    out = detect_document_type_node({"ocr_text": "..."}, deps)

    assert out["document_type"] == "autre"


@pytest.mark.parametrize(
    "type_detecte,attendu",
    [
        ("facture", "extract_fields"),
        ("virement", "extract_virement"),
        ("contrat", "extract_contrat"),
        ("autre", "reject_unsupported"),
    ],
)
def test_aiguillage_complet(type_detecte, attendu):
    assert route_by_doc_type({"document_type": type_detecte}) == attendu


# -- Message rendu à l'utilisateur -------------------------------------------
def test_le_message_nomme_les_trois_types_attendus():
    out = reject_unsupported_node({"detected_nature": None}, None)

    assert out["status"] == "non_pris_en_charge"
    assert out["saved"] is False
    for attendu in ("facture", "virement", "contrat"):
        assert attendu in out["message"]
    assert "n'a donc pas été enregistré" in out["message"]


def test_le_message_precise_la_nature_devinee():
    out = reject_unsupported_node({"detected_nature": "bulletin de paie"}, None)
    assert "bulletin de paie" in out["message"]


# -- Parcours complet --------------------------------------------------------
def _lancer(graph, thread: str):
    config = {"configurable": {"thread_id": thread}}
    payload = {
        "user_id": "u-hp",
        "document_id": "doc-hp",
        "filename": "carte-identite.jpg",
        "mime": "image/jpeg",
        "file_b64": base64.b64encode(b"image").decode("ascii"),
        "messages": [],
    }
    try:
        graph.invoke(payload, config)
    except GraphInterrupt:
        pass
    snap = graph.get_state(config)
    interruptions = [i for t in snap.tasks for i in (getattr(t, "interrupts", None) or [])]
    return (snap.values or {}), interruptions


def test_le_parcours_s_arrete_sans_rien_enregistrer():
    mistral = _Detecteur({"type": "autre", "nature": "carte d'identité"})
    deps = _deps(mistral)
    graph = build_graph(deps, MemorySaver())

    values, interruptions = _lancer(graph, "t-hors-perimetre")

    assert not interruptions, "un document écarté ne doit rien demander à l'utilisateur"
    assert values["document_type"] == "autre"
    assert values["status"] == "non_pris_en_charge"
    assert values["saved"] is False
    # Aucune extraction n'a été tentée : la doublure lèverait sur tout autre prompt.
    assert mistral.appels == ["detection"]
    # Aucun registre n'est pollué.
    assert deps.db.list_invoices("u-hp") == []
    assert deps.db.list_virements("u-hp") == []
    assert deps.db.list_contrats("u-hp") == []
    assert deps.db.get_document_by_id("u-hp", "doc-hp") is None


def test_aucune_analyse_ni_incoherence_n_est_produite():
    deps = _deps(_Detecteur({"type": "autre", "nature": None}))
    graph = build_graph(deps, MemorySaver())

    values, _ = _lancer(graph, "t-hors-perimetre-2")

    assert values.get("analysis") is None
    assert values.get("incoherences") is None
    assert values.get("invoice") is None
    assert values.get("contrat") is None
