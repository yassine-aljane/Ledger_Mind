"""Branche contrat de l'agent capture : extraction, contrôles, HITL, persistance.

Couvre ce que l'intégration doit préserver :
  • le type détecté aiguille vers le bon pipeline — un contrat ne doit pas
    tomber dans la moulinette « facture », qui en tirerait des montants faux ;
  • les contrôles de cohérence sont DÉTERMINISTES (dates, durée, parties) et
    portent sur la cohérence interne du document, jamais sur la validité
    juridique des clauses ;
  • la nature du contrat reste dans la nomenclature : une valeur inattendue
    devient « autre » plutôt qu'un type inventé (FR-08) ;
  • un contrat incomplet déclenche le HITL puis reprend, comme les autres pièces ;
  • la persistance porte de quoi retrouver et réafficher la pièce.

`mongomock` remplace MongoDB ; aucun appel LLM ni réseau.
"""

from __future__ import annotations

import base64

import mongomock
import pytest

from app.agents.capture.app.nodes import (
    Deps,
    _coerce_field,
    _compute_missing_contrat,
    _safe_contrat,
    compute_contrat_incoherences,
    route_by_doc_type,
    save_contrat_node,
)
from app.agents.capture.app.db import Database
from app.agents.capture.app.schemas import Contract, ContractParty


class _MistralInutilise:
    """Les nœuds testés ici n'appellent pas le LLM."""


def _deps() -> Deps:
    db = Database(mongomock.MongoClient(), "testdb")
    db.ensure_indexes()
    return Deps(mistral=_MistralInutilise(), db=db)


def _contrat(**champs) -> Contract:
    base = {
        "contract_type": "sponsoring",
        "title": "Contrat de sponsoring 2026",
        "reference": "SPO-2026-14",
        "parties": [
            ContractParty(name="Studio Nova", role="sponsor"),
            ContractParty(name="Créateur Solo", role="bénéficiaire"),
        ],
        "signature_date": "2026-01-10",
        "start_date": "2026-02-01",
        "end_date": "2026-07-31",
        "duration_months": 6,
        "amount": 9000.0,
        "currency": "EUR",
    }
    base.update(champs)
    return Contract(**base)


# -- Aiguillage --------------------------------------------------------------
@pytest.mark.parametrize(
    "detecte,attendu",
    [
        ("contrat", "extract_contrat"),
        ("virement", "extract_virement"),
        ("facture", "extract_fields"),
        (None, "extract_fields"),          # défaut sûr
        ("inconnu", "extract_fields"),
    ],
)
def test_aiguillage_par_type_de_document(detecte, attendu):
    assert route_by_doc_type({"document_type": detecte}) == attendu


# -- Nomenclature ------------------------------------------------------------
def test_type_hors_nomenclature_devient_autre():
    assert _coerce_field("contract_type", "sponsoring") == "sponsoring"
    assert _coerce_field("contract_type", "SPONSORING") == "sponsoring"
    # Un type inventé par le LLM ou saisi à la main est rangé, pas inventé.
    assert _coerce_field("contract_type", "contrat de mécénat spatial") == "autre"
    assert _coerce_field("contract_type", "") is None


def test_coercition_des_champs_de_contrat():
    assert _coerce_field("start_date", "01/02/2026") == "2026-02-01"
    assert _coerce_field("notice_period_days", "30") == 30
    assert _coerce_field("duration_months", "12") == 12
    assert _coerce_field("notice_period_days", "illisible") is None


# -- Champs obligatoires (HITL) ---------------------------------------------
def test_champs_manquants_declenchent_le_hitl():
    assert _compute_missing_contrat(_contrat()) == []
    assert _compute_missing_contrat(_contrat(start_date=None)) == ["start_date"]
    manquants = _compute_missing_contrat(_contrat(contract_type=None, start_date=None))
    assert manquants == ["contract_type", "start_date"]


def test_un_contrat_sans_montant_ne_bloque_pas():
    """Un accord de confidentialité n'a pas de contrepartie : ce n'est pas un manque."""
    assert _compute_missing_contrat(_contrat(amount=None, currency=None)) == []


# -- Contrôles déterministes -------------------------------------------------
def test_aucune_anomalie_sur_un_contrat_coherent():
    assert compute_contrat_incoherences(_contrat(end_date="2036-07-31", duration_months=None)) == []


def test_fin_anterieure_au_debut():
    issues = compute_contrat_incoherences(_contrat(start_date="2026-02-01", end_date="2026-01-01"))
    assert any("antérieure à la prise d'effet" in i for i in issues)


def test_signature_posterieure_a_la_prise_d_effet():
    issues = compute_contrat_incoherences(_contrat(signature_date="2026-03-01"))
    assert any("après sa prise d'effet" in i for i in issues)


def test_duree_incompatible_avec_les_dates():
    issues = compute_contrat_incoherences(
        _contrat(start_date="2026-02-01", end_date="2026-07-31", duration_months=24)
    )
    assert any("incompatible avec les" in i for i in issues)


def test_tolerance_d_un_mois_sur_la_duree():
    """Les mois de 28 à 31 jours ne doivent pas produire de fausse anomalie."""
    issues = compute_contrat_incoherences(
        _contrat(start_date="2026-02-01", end_date="2026-07-31", duration_months=6)
    )
    assert not any("incompatible" in i for i in issues)


def test_duree_indeterminee_avec_date_de_fin():
    issues = compute_contrat_incoherences(_contrat(is_open_ended=True))
    assert any("durée indéterminée" in i for i in issues)


def test_parties_insuffisantes():
    issues = compute_contrat_incoherences(_contrat(parties=[ContractParty(name="Seul")]))
    assert any("partie identifiée" in i for i in issues)
    issues = compute_contrat_incoherences(_contrat(parties=[]))
    assert any("Aucune partie" in i for i in issues)


def test_contrepartie_et_preavis_invalides():
    issues = compute_contrat_incoherences(_contrat(amount=-5.0))
    assert any("Montant de la contrepartie invalide" in i for i in issues)
    issues = compute_contrat_incoherences(_contrat(notice_period_days=-10))
    assert any("Préavis négatif" in i for i in issues)
    issues = compute_contrat_incoherences(_contrat(currency=None))
    assert any("Devise absente" in i for i in issues)


def test_contrat_echu_est_signale():
    issues = compute_contrat_incoherences(
        _contrat(start_date="2020-01-01", end_date="2020-12-31", duration_months=None)
    )
    assert any("arrivé à échéance" in i for i in issues)


# -- Tolérance de l'extraction ----------------------------------------------
def test_une_partie_malformee_ne_fait_pas_perdre_les_autres():
    contrat = _safe_contrat(
        {
            "contract_type": "partenariat",
            "start_date": "2026-01-01",
            "parties": [
                {"name": "Studio Nova", "role": "partenaire"},
                "chaîne inattendue",                     # entrée malformée
                {"name": "Créateur Solo", "role": "partenaire"},
            ],
            "obligations": ["Fournir 4 vidéos", None, "Citer la marque"],
        }
    )
    assert [p.name for p in contrat.parties] == ["Studio Nova", "Créateur Solo"]
    assert contrat.obligations == ["Fournir 4 vidéos", "Citer la marque"]


def test_donnee_non_exploitable_donne_un_contrat_vide():
    assert _safe_contrat("pas un objet").contract_type is None
    assert _safe_contrat(None).parties == []


# -- Persistance -------------------------------------------------------------
def _etat(**extra):
    base = {
        "user_id": "u1",
        "document_id": "doc-c1",
        "filename": "contrat-sponsoring.pdf",
        "mime": "application/pdf",
        "file_b64": base64.b64encode(b"%PDF-1.4 contrat").decode("ascii"),
        "contrat": _contrat().model_dump(),
        "analysis": "Engagement de sponsoring sur six mois.",
        "incoherences": [],
    }
    base.update(extra)
    return base


def test_le_contrat_est_enregistre_avec_ses_reperes():
    deps = _deps()
    out = save_contrat_node(_etat(), deps)

    assert out["saved"] is True
    doc = deps.db.get_document_by_id("u1", "doc-c1")
    assert doc["document_type"] == "contrat"
    assert doc["filename"] == "contrat-sponsoring.pdf"
    assert doc["contract"]["reference"] == "SPO-2026-14"
    assert doc["contract"]["parties"][0]["name"] == "Studio Nova"
    # Clé de déduplication remontée à la racine pour l'index unique.
    assert doc["reference"] == "SPO-2026-14"
    assert doc["contract_type"] == "sponsoring"


def test_doublon_confirme_n_enregistre_rien():
    deps = _deps()
    out = save_contrat_node(_etat(duplicate_decision="confirme"), deps)

    assert out["saved"] is False
    assert out["duplicate_skipped"] is True
    assert deps.db.get_document_by_id("u1", "doc-c1") is None


def test_deuxieme_depot_du_meme_contrat_est_rejete_par_l_index():
    deps = _deps()
    save_contrat_node(_etat(), deps)
    out = save_contrat_node(_etat(document_id="doc-c2"), deps)

    assert out["saved"] is False
    assert out["duplicate_skipped"] is True


def test_les_contrats_apparaissent_dans_leur_listing():
    deps = _deps()
    save_contrat_node(_etat(), deps)

    contrats = deps.db.list_contrats("u1")
    assert len(contrats) == 1
    assert contrats[0]["document_id"] == "doc-c1"
    # Et ne polluent pas les autres registres.
    assert deps.db.list_invoices("u1") == []
    assert deps.db.list_virements("u1") == []


def test_suppression_d_un_contrat():
    deps = _deps()
    save_contrat_node(_etat(), deps)

    assert deps.db.delete_document("u1", "doc-c1") is True
    assert deps.db.get_document_by_id("u1", "doc-c1") is None
    assert deps.db.list_contrats("u1") == []


# -- Parcours complet dans le graphe ----------------------------------------
class _FakeMistral:
    """Doublure du LLM, branchée sur des marqueurs de prompt (aucun réseau)."""

    def __init__(self, contrat: dict, suggestions: dict | None = None):
        self.contrat = contrat
        self.suggestions = suggestions or {}

    def ocr(self, data: bytes, mime: str) -> str:
        return "CONTRAT DE SPONSORING\nEntre les soussignés...\nArticle 1 - Objet"

    def chat_json(self, model, system, user, *, temperature=0.0, fallback_model=None):
        if "détecteur de langue" in system:
            return {"language": "fr"}
        if "NATURE d'un document" in system:
            return {"type": "contrat"}
        if "CONTRAT français" in system:
            return dict(self.contrat)
        if "CANDIDATES" in system:
            return dict(self.suggestions)
        raise AssertionError(f"Prompt chat_json inattendu : {system[:70]!r}")

    def chat_text(self, model, system, user, *, temperature=0.0, fallback_model=None):
        if "de ce CONTRAT" in system:
            return "Engagement de sponsoring sur six mois, à intégrer au chiffre d'affaires."
        raise AssertionError(f"Prompt chat_text inattendu : {system[:70]!r}")


def _graphe(mistral):
    from langgraph.checkpoint.memory import MemorySaver

    from app.agents.capture.app.graph import build_graph

    db = Database(mongomock.MongoClient(), "testdb")
    db.ensure_indexes()
    deps = Deps(mistral=mistral, db=db)
    return build_graph(deps, MemorySaver()), deps


def _lancer(graph, user_id, thread):
    from langgraph.errors import GraphInterrupt

    config = {"configurable": {"thread_id": thread}}
    payload = {
        "user_id": user_id,
        "document_id": "doc-flow",
        "filename": "contrat.pdf",
        "mime": "application/pdf",
        "file_b64": base64.b64encode(b"contrat").decode("ascii"),
        "messages": [],
    }
    try:
        graph.invoke(payload, config)
    except GraphInterrupt:
        pass
    return config


def _etat_du_graphe(graph, config):
    snap = graph.get_state(config)
    interruptions = [i for t in snap.tasks for i in (getattr(t, "interrupts", None) or [])]
    return (snap.values or {}), interruptions


def test_parcours_complet_contrat_sans_intervention():
    """Un contrat complet traverse détection -> extraction -> analyse -> sauvegarde."""
    graph, deps = _graphe(_FakeMistral(_contrat().model_dump()))
    config = _lancer(graph, "uc1", "t-contrat-ok")
    values, interruptions = _etat_du_graphe(graph, config)

    assert not interruptions
    assert values["document_type"] == "contrat"
    assert values["status"] == "completed"
    assert values["saved"] is True
    assert values["analysis"]

    enregistre = deps.db.list_contrats("uc1")[0]
    assert enregistre["contract"]["contract_type"] == "sponsoring"
    assert enregistre["contract"]["amount"] == 9000.0


def test_champ_manquant_interrompt_puis_reprend():
    """HITL : le graphe s'arrête, attend la réponse, puis termine son parcours."""
    from langgraph.errors import GraphInterrupt
    from langgraph.types import Command

    incomplet = _contrat(start_date=None).model_dump()
    graph, deps = _graphe(_FakeMistral(incomplet, suggestions={"start_date": ["01/02/2026"]}))
    config = _lancer(graph, "uc2", "t-contrat-hitl")

    values, interruptions = _etat_du_graphe(graph, config)
    assert interruptions, "un champ obligatoire manquant doit interrompre le parcours"
    demande = interruptions[0].value
    assert demande["type"] == "champ_manquant"
    assert demande["field"] == "start_date"
    assert "01/02/2026" in demande["suggestions"]
    assert deps.db.list_contrats("uc2") == [], "rien ne doit être enregistré avant la réponse"

    # L'utilisateur répond : le parcours reprend et s'achève.
    try:
        graph.invoke(Command(resume="01/02/2026"), config)
    except GraphInterrupt:
        pass

    values, interruptions = _etat_du_graphe(graph, config)
    assert not interruptions
    assert values["saved"] is True
    assert deps.db.list_contrats("uc2")[0]["contract"]["start_date"] == "2026-02-01"


def test_les_incoherences_sont_calculees_pendant_le_parcours():
    incoherent = _contrat(start_date="2026-02-01", end_date="2026-01-01").model_dump()
    graph, _ = _graphe(_FakeMistral(incoherent))
    config = _lancer(graph, "uc3", "t-contrat-incoherent")
    values, _ = _etat_du_graphe(graph, config)

    assert any("antérieure à la prise d'effet" in i for i in values["incoherences"])
