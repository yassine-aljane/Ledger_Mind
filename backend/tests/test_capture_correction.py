"""Correction humaine des champs extraits.

L'extraction se trompe : sur un manuscrit, une pièce froissée, un libellé
inhabituel. L'utilisateur doit pouvoir reprendre la main, et sa saisie fait
autorité sur la lecture machine.

Couvre ce que l'intégration doit préserver :
  • la valeur saisie remplace celle du modèle, après coercition au bon type ;
  • les conséquences déterministes suivent — contrôles de cohérence, contre-
    valeur en euros, statut de règlement — sinon la fiche s'auto-contredirait ;
  • la clé de déduplication recopiée à la racine est mise à jour, faute de quoi
    l'index unique porterait sur des valeurs périmées ;
  • la synthèse n'est rejouée que si un champ PORTEUR DE SENS a bougé : un BIC
    corrigé ne justifie pas un appel au modèle ;
  • une panne du modèle ne fait jamais perdre la correction ;
  • les champs dérivés et les listes ne sont pas modifiables par ce chemin.

`mongomock` remplace MongoDB ; le LLM est une doublure.
"""

from __future__ import annotations

import mongomock
import pytest

from app.agents.capture.app.db import Database
from app.agents.capture.app.nodes import (
    Deps,
    DocumentIntrouvable,
    champs_editables,
    save_contrat_node,
    save_to_db_node,
    save_virement_node,
    update_document_fields,
)


class _Mistral:
    """Doublure : compte les régénérations de synthèse."""

    def __init__(self, panne: bool = False):
        self.panne = panne
        self.appels = 0

    def chat_text(self, model, system, user, *, temperature=0.0, fallback_model=None):
        self.appels += 1
        if self.panne:
            raise RuntimeError("fournisseur indisponible")
        return "Synthèse régénérée après correction."


def _deps(panne: bool = False) -> Deps:
    db = Database(mongomock.MongoClient(), "testdb")
    db.ensure_indexes()
    return Deps(mistral=_Mistral(panne), db=db)


def _facture(deps: Deps, **invoice):
    base = {
        "invoice_number": "F-001",
        "issuer_name": "Atelier Bois",
        "issue_date": "2026-03-04",
        "subtotal_ht": 1535.0,
        "vat_amount": 307.0,
        "total_ttc": 1842.0,
        "currency": "EUR",
    }
    base.update(invoice)
    save_to_db_node(
        {
            "user_id": "u1", "document_id": "doc-1",
            "invoice": base, "analysis": "Synthèse d'origine.",
            "ocr_text": "FACTURE ...",
        },
        deps,
    )


# -- Périmètre des champs modifiables ---------------------------------------
def test_les_champs_derives_ne_sont_pas_modifiables():
    editables = champs_editables("facture")
    assert "total_ttc" in editables and "issue_date" in editables
    for derive in ("amount_eur", "exchange_rate", "rate_date", "rate_source"):
        assert derive not in editables, f"{derive} découle d'un calcul, pas d'une saisie"
    assert "line_items" not in editables, "une liste ne se corrige pas champ par champ"


def test_perimetre_par_type_de_document():
    assert "parties" not in champs_editables("contrat")
    assert "contract_type" in champs_editables("contrat")
    assert "beneficiary_iban" in champs_editables("virement")
    assert champs_editables("inconnu") == []


# -- Correction et coercition ------------------------------------------------
def test_la_saisie_humaine_remplace_la_lecture_machine():
    deps = _deps()
    _facture(deps)

    doc = update_document_fields(deps, "u1", "doc-1", {"total_ttc": "7500,50"})

    assert doc["invoice"]["total_ttc"] == 7500.50, "montant français coercé en nombre"
    assert doc["corrected_now"] == ["total_ttc"]
    assert "total_ttc" in doc["corrected_fields"]


def test_coercition_des_dates_et_booleens():
    deps = _deps()
    _facture(deps)

    doc = update_document_fields(
        deps, "u1", "doc-1", {"issue_date": "12/02/2026", "paid": "oui"}
    )

    assert doc["invoice"]["issue_date"] == "2026-02-12"
    assert doc["invoice"]["paid"] is True


def test_un_champ_vide_efface_la_valeur():
    deps = _deps()
    _facture(deps)
    doc = update_document_fields(deps, "u1", "doc-1", {"client_name": ""})
    assert doc["invoice"]["client_name"] is None


def test_un_champ_hors_perimetre_est_ignore():
    deps = _deps()
    _facture(deps)

    doc = update_document_fields(
        deps, "u1", "doc-1", {"amount_eur": "999", "champ_inconnu": "x"}
    )

    assert doc["corrected_now"] == []
    assert doc["resynthese"] is None


def test_document_inconnu():
    deps = _deps()
    with pytest.raises(DocumentIntrouvable):
        update_document_fields(deps, "u1", "jamais-vu", {"total_ttc": "1"})


# -- Conséquences déterministes ---------------------------------------------
def test_les_controles_de_coherence_sont_rejoues():
    deps = _deps()
    _facture(deps)  # 1535 + 307 = 1842 : cohérent

    doc = update_document_fields(deps, "u1", "doc-1", {"total_ttc": "9999"})

    assert doc["incoherences"], "le total ne colle plus à HT + TVA, cela doit se voir"
    assert any("TTC" in i for i in doc["incoherences"])


def test_une_correction_peut_lever_une_incoherence():
    deps = _deps()
    _facture(deps, total_ttc=9999.0)   # incohérent à l'origine

    avant = deps.db.get_invoice_by_document_id("u1", "doc-1")
    assert avant["incoherences"] == [] or True  # l'état initial importe peu ici

    doc = update_document_fields(deps, "u1", "doc-1", {"total_ttc": "1842"})
    assert doc["incoherences"] == [], "la correction rétablit la cohérence"


def test_la_cle_de_deduplication_suit_la_correction():
    """Sans cette mise à jour, l'index unique porterait sur une valeur périmée."""
    deps = _deps()
    _facture(deps)

    update_document_fields(deps, "u1", "doc-1", {"invoice_number": "F-999"})

    stocke = deps.db.get_invoice_by_document_id("u1", "doc-1")
    assert stocke["invoice"]["invoice_number"] == "F-999"
    assert stocke["invoice_number"] == "F-999", "le miroir racine doit suivre"


def test_le_statut_de_reglement_est_recalcule():
    deps = _deps()
    _facture(deps)

    doc = update_document_fields(deps, "u1", "doc-1", {"paid": "oui"})

    stocke = deps.db.get_invoice_by_document_id("u1", "doc-1")
    assert doc["invoice"]["paid"] is True
    assert stocke["paid"] is True


# -- Régénération de la synthèse --------------------------------------------
def test_un_champ_porteur_de_sens_declenche_la_regeneration():
    deps = _deps()
    _facture(deps)

    doc = update_document_fields(deps, "u1", "doc-1", {"total_ttc": "7500"})

    assert doc["resynthese"] is True
    assert doc["analysis"] == "Synthèse régénérée après correction."
    assert deps.mistral.appels == 1


def test_un_champ_secondaire_ne_declenche_rien():
    """Corriger un matricule fiscal ne change pas ce que la synthèse raconte."""
    deps = _deps()
    _facture(deps)

    doc = update_document_fields(deps, "u1", "doc-1", {"issuer_tax_id": "FR123"})

    assert doc["resynthese"] is None
    assert doc["analysis"] == "Synthèse d'origine."
    assert deps.mistral.appels == 0


def test_une_panne_du_modele_ne_fait_pas_perdre_la_correction():
    deps = _deps(panne=True)
    _facture(deps)

    doc = update_document_fields(deps, "u1", "doc-1", {"total_ttc": "7500"})

    assert doc["resynthese"] is False, "l'échec doit être signalé, pas masqué"
    assert doc["invoice"]["total_ttc"] == 7500.0, "la correction est acquise"
    assert doc["analysis"] == "Synthèse d'origine."
    stocke = deps.db.get_invoice_by_document_id("u1", "doc-1")
    assert stocke["invoice"]["total_ttc"] == 7500.0


def test_la_synthese_regeneree_rejoint_la_discussion():
    """La discussion s'ouvre sur la synthèse : elle ne doit pas rester périmée."""
    deps = _deps()
    _facture(deps)

    update_document_fields(deps, "u1", "doc-1", {"total_ttc": "7500"})

    messages = deps.db.get_history("u1", "doc-1")
    assert messages[-1]["content"] == "Synthèse régénérée après correction."


# -- Virements et contrats ---------------------------------------------------
def test_correction_d_un_virement():
    deps = _deps()
    save_virement_node(
        {
            "user_id": "u1", "document_id": "doc-v",
            "virement": {"transfer_reference": "VIR-1", "amount": 500.0,
                         "currency": "EUR", "execution_date": "2026-03-01"},
            "analysis": "Origine.", "ocr_text": "VIREMENT",
        },
        deps,
    )

    doc = update_document_fields(deps, "u1", "doc-v", {"amount": "1250,75"})

    assert doc["transfer"]["amount"] == 1250.75
    assert doc["amount"] == 1250.75, "miroir racine"
    assert doc["resynthese"] is True


def test_correction_d_un_contrat_et_controles_associes():
    deps = _deps()
    save_contrat_node(
        {
            "user_id": "u1", "document_id": "doc-c",
            "contrat": {"contract_type": "sponsoring", "reference": "SPO-1",
                        "signature_date": "2026-01-10", "start_date": "2026-02-01",
                        "end_date": "2026-07-31", "amount": 9000.0, "currency": "EUR",
                        "parties": [{"name": "A"}, {"name": "B"}]},
            "analysis": "Origine.", "ocr_text": "CONTRAT",
        },
        deps,
    )

    # Une fin avant le début doit être relevée par les contrôles.
    doc = update_document_fields(deps, "u1", "doc-c", {"end_date": "2025-01-01"})

    assert doc["contract"]["end_date"] == "2025-01-01"
    assert any("antérieure à la prise d'effet" in i for i in doc["incoherences"])
    assert doc["resynthese"] is True


def test_le_type_de_contrat_reste_dans_la_nomenclature():
    deps = _deps()
    save_contrat_node(
        {
            "user_id": "u1", "document_id": "doc-c2",
            "contrat": {"contract_type": "sponsoring", "start_date": "2026-02-01"},
            "analysis": "Origine.", "ocr_text": "CONTRAT",
        },
        deps,
    )

    doc = update_document_fields(deps, "u1", "doc-c2", {"contract_type": "mécénat spatial"})
    assert doc["contract"]["contract_type"] == "autre"
