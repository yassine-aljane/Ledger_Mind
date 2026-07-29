"""Tests de bout en bout du graphe Agent 3 (sans clé API ni MongoDB réel).

Couvre : chemin nominal + sauvegarde, interruption champ manquant + reprise,
confirmation de doublon, question de suivi Q&A, et l'absence totale de RAG.
"""
from __future__ import annotations

import copy
import pathlib
import re

from langgraph.types import Command

from app.nodes import answer_question
from tests.fakes import (
    COMPLETE_INVOICE,
    FakeMistral,
    initial_state,
    inspect,
    make_db,
    make_graph,
    run,
)


def test_happy_path_and_duplicate_confirmation():
    """Facture complète -> completed + sauvegarde ; ré-upload -> doublon HITL."""
    db = make_db()
    mistral = FakeMistral(invoice=copy.deepcopy(COMPLETE_INVOICE), category="services")
    graph, deps = make_graph(mistral, db)

    # 1) Chemin nominal
    cfg = run(graph, initial_state("u1"), "t-happy")
    values, ints = inspect(graph, cfg)
    assert not ints
    assert values["status"] == "completed"
    assert values["saved"] is True
    assert values["duplicate_skipped"] is False
    assert values["expense_category"] == "services"
    assert values["analysis"]
    assert len(db.list_invoices("u1")) == 1

    # 2) Ré-upload de la MÊME facture -> détection de doublon + interruption
    graph2, _ = make_graph(FakeMistral(invoice=copy.deepcopy(COMPLETE_INVOICE)), db)
    cfg2 = run(graph2, initial_state("u1"), "t-dup")
    _, ints2 = inspect(graph2, cfg2)
    assert ints2, "un doublon aurait dû interrompre le graphe"
    payload = ints2[0].value
    assert payload["type"] == "doublon"
    assert payload["existing_invoice"]["invoice_number"] == "F-2026-001"
    assert payload["new_invoice"]["invoice_number"] == "F-2026-001"

    # L'utilisateur confirme : « oui » -> insertion ignorée, pas de rejet auto
    run(graph2, Command(resume="oui"), "t-dup")
    values2, ints2 = inspect(graph2, cfg2)
    assert not ints2
    assert values2["duplicate_skipped"] is True
    assert values2["saved"] is False
    assert len(db.list_invoices("u1")) == 1  # toujours une seule facture


def test_missing_field_interrupt_offers_suggestions_then_resume():
    """Total TTC manquant -> question FR + suggestions proposées -> approbation."""
    db = make_db()
    invoice = copy.deepcopy(COMPLETE_INVOICE)
    invoice["total_ttc"] = None  # champ obligatoire manquant
    # Le LLM propose des candidats lus dans le document (HITL assisté).
    mistral = FakeMistral(invoice=invoice, suggestions={"total_ttc": ["1234,56", "1200"]})
    graph, _ = make_graph(mistral, db)

    cfg = run(graph, initial_state("u2"), "t-missing")
    values, ints = inspect(graph, cfg)
    assert ints, "un champ manquant aurait dû interrompre le graphe"
    q = ints[0].value
    assert q["type"] == "champ_manquant"
    assert q["field"] == "total_ttc"
    # Question en français + propositions candidates remontées à l'utilisateur
    assert "passer" in q["question"].lower()
    assert q["suggestions"] == ["1234,56", "1200"]
    assert values["status"] != "completed"

    # L'utilisateur APPROUVE la première proposition (saisie française -> float)
    run(graph, Command(resume="1234,56"), "t-missing")
    values, ints = inspect(graph, cfg)
    assert not ints
    assert values["status"] == "completed"
    assert values["invoice"]["total_ttc"] == 1234.56
    assert values["saved"] is True


def test_english_invoice_is_translated_before_processing():
    """Facture en anglais -> détectée -> traduite -> sortie en français."""
    db = make_db()
    invoice = copy.deepcopy(COMPLETE_INVOICE)
    mistral = FakeMistral(
        invoice=invoice,
        language="en",
        translation="FACTURE (traduite) — total TTC 120,00 EUR",
        ocr_text="INVOICE — english OCR text",
    )
    graph, _ = make_graph(mistral, db)

    cfg = run(graph, initial_state("u3"), "t-en")
    values, ints = inspect(graph, cfg)
    assert not ints
    assert values["detected_language"] == "en"
    # Le texte de travail a été remplacé par la traduction française
    assert values["ocr_text"].startswith("FACTURE (traduite)")
    assert values["ocr_text_original"] == "INVOICE — english OCR text"
    assert values["status"] == "completed"


def test_followup_qa_grounded_on_stored_ocr_and_history():
    """Q&A sur une facture traitée : ancrée sur l'OCR stocké + historique."""
    db = make_db()
    graph, deps = make_graph(FakeMistral(invoice=copy.deepcopy(COMPLETE_INVOICE)), db)
    run(graph, initial_state("u4"), "t-qa")

    doc = db.list_invoices("u4")[0]
    document_id = doc["document_id"]

    ans = answer_question(deps, "u4", document_id, "Quel est le montant TTC ?")
    assert ans  # réponse produite
    history = db.get_history("u4", document_id)
    roles = [m["role"] for m in history]
    # analyse initiale (assistant) + question (user) + réponse (assistant)
    assert "user" in roles and roles.count("assistant") >= 2


def test_incoherences_and_payment_are_deterministic():
    """Cohérence arithmétique + échéance calculées sans LLM."""
    from app.nodes import compute_incoherences, compute_payment
    from app.schemas import Invoice

    # Total incohérent (100 + 20 != 200) -> anomalie détectée
    bad = Invoice(subtotal_ht=100, vat_amount=20, total_ttc=200, currency="EUR",
                  issue_date="2026-02-12", payment_terms_days=30, paid=False)
    issues = compute_incoherences(bad)
    assert any("TTC" in i for i in issues), issues

    pay = compute_payment(bad)
    assert pay["paid"] is False
    # Échéance = date d'émission + 30 jours (déterministe)
    assert pay["payment_date"] == "2026-03-14"
    assert "14/03/2026" in pay["note"]  # date FR reprise dans la note

    # Facture cohérente -> aucune incohérence
    good = Invoice(subtotal_ht=100, vat_amount=20, total_ttc=120, currency="EUR")
    assert compute_incoherences(good) == []


def test_virement_detected_extracted_and_saved():
    """Un virement est détecté, extrait, analysé et stocké dans `virements`."""
    db = make_db()
    vir = {
        "transfer_reference": "VIR-2026-042",
        "execution_date": "2026-03-01",
        "amount": 1500.0, "currency": "EUR", "direction": "recu",
        "beneficiary_name": "Créateur Solo",
        "beneficiary_iban": "FR1420041010050500013M02606",
        "motif": "Partenariat sponsorisé", "transfer_type": "SEPA",
    }
    mistral = FakeMistral(invoice={}, document_type="virement", virement=vir,
                          ocr_text="AVIS DE VIREMENT SEPA — IBAN ...")
    graph, _ = make_graph(mistral, db)

    cfg = run(graph, initial_state("uv"), "t-vir")
    values, ints = inspect(graph, cfg)
    assert not ints
    assert values["status"] == "completed"
    assert values["document_type"] == "virement"
    assert values["saved"] is True
    assert values["analysis"]

    saved = db.list_virements("uv")
    assert len(saved) == 1
    assert saved[0]["transfer"]["amount"] == 1500.0
    assert saved[0]["transfer"]["transfer_reference"] == "VIR-2026-042"
    # IBAN valide -> aucune incohérence
    assert saved[0]["incoherences"] == []


def test_virement_missing_field_hitl_then_resume():
    """Montant manquant sur un virement -> HITL (avec suggestions) -> reprise."""
    db = make_db()
    vir = {"transfer_reference": "VIR-9", "execution_date": "2026-03-01", "amount": None,
           "currency": "EUR", "beneficiary_name": "Créateur Solo"}
    mistral = FakeMistral(invoice={}, document_type="virement", virement=vir,
                          suggestions={"amount": ["1500", "1200"]})
    graph, _ = make_graph(mistral, db)

    cfg = run(graph, initial_state("uvm"), "t-virm")
    values, ints = inspect(graph, cfg)
    assert ints, "montant manquant aurait dû interrompre"
    q = ints[0].value
    assert q["type"] == "champ_manquant"
    assert q["field"] == "amount"
    assert q["suggestions"] == ["1500", "1200"]

    run(graph, Command(resume="1500"), "t-virm")
    values, ints = inspect(graph, cfg)
    assert not ints
    assert values["status"] == "completed"
    assert values["saved"] is True
    assert values["virement"]["amount"] == 1500.0
    assert len(db.list_virements("uvm")) == 1


def test_virement_duplicate_confirmation():
    """Ré-upload d'un virement identique -> doublon HITL -> insertion ignorée."""
    db = make_db()
    vir = {"transfer_reference": "VIR-DUP", "execution_date": "2026-03-02", "amount": 800.0,
           "currency": "EUR", "beneficiary_iban": "FR1420041010050500013M02606"}

    g1, _ = make_graph(FakeMistral(invoice={}, document_type="virement", virement=dict(vir)), db)
    run(g1, initial_state("uvd"), "t-v1")
    assert len(db.list_virements("uvd")) == 1

    g2, _ = make_graph(FakeMistral(invoice={}, document_type="virement", virement=dict(vir)), db)
    cfg2 = run(g2, initial_state("uvd"), "t-v2")
    _, ints2 = inspect(g2, cfg2)
    assert ints2 and ints2[0].value["type"] == "doublon"

    run(g2, Command(resume="oui"), "t-v2")
    values2, ints2 = inspect(g2, cfg2)
    assert not ints2
    assert values2["duplicate_skipped"] is True
    assert values2["saved"] is False
    assert len(db.list_virements("uvd")) == 1  # toujours un seul


def test_iban_validation_flags_bad_key():
    """La clé de contrôle IBAN (mod 97) est vérifiée sans LLM."""
    from app.nodes import _iban_valid, compute_virement_incoherences
    from app.schemas import BankTransfer

    good = "FR1420041010050500013M02606"
    bad = "FR1420041010050500013M02607"  # dernier caractère modifié
    assert _iban_valid(good) is True
    assert _iban_valid(bad) is False

    flagged = compute_virement_incoherences(BankTransfer(amount=100, currency="EUR", beneficiary_iban=bad))
    assert any("IBAN" in i for i in flagged)
    assert compute_virement_incoherences(BankTransfer(amount=100, currency="EUR", beneficiary_iban=good)) == []


def test_no_rag_anywhere_in_codebase():
    """Garde-fou DoD : aucun vector store / embedding / RAG dans app/."""
    app_dir = pathlib.Path(__file__).resolve().parent.parent / "app"
    pattern = re.compile(r"chroma|embedding|vectorstore|faiss", re.IGNORECASE)
    offending = []
    for py in app_dir.rglob("*.py"):
        if pattern.search(py.read_text(encoding="utf-8")):
            offending.append(py.name)
    assert not offending, f"Termes RAG interdits trouvés dans : {offending}"
