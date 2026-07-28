"""Unit tests for intake tax + compliance tools (Kbis/RCS logic)."""

from app.agents.intake.agent import finalize_profile
from app.agents.intake.tools.classify_tax import classify_tax_category, detect_fiscal_inconsistency
from app.schemas.orchestrator import UserProfile
from app.services.ocr_registry_doc import _classify_from_text


def test_classify_inpi_rne_extract():
    text = """
    Entreprise individuelle
    Identité de l'entreprise
    SIRET 895 011 161 00012
    www.inpi.fr
    Guichet unique
    """
    doc = _classify_from_text(text)
    assert doc.document_type == "rne_extract"


def test_classify_kbis_document():
    text = """
    EXTRAIT KBIS
    Greffe du Tribunal de Commerce de Paris
    RCS Paris 123 456 789
    """
    doc = _classify_from_text(text)
    assert doc.document_type == "kbis"


def test_bnc_when_no_kbis():
    profile = UserProfile(
        registry_tax_base="BNC",
        rcs_registered=False,
        kbis_obtained=False,
        main_activity_commercial=False,
        activity_types=["Création artistique"],
    )
    category, reason, regime, plafond, status = classify_tax_category(profile)
    assert category == "BNC"
    assert status == "confirmed"
    assert regime == "Micro-BNC"
    assert "BNC" in reason


def test_bic_when_kbis_confirmed():
    profile = UserProfile(
        registry_tax_base="BIC",
        rcs_registered=True,
        kbis_obtained=True,
        main_activity_commercial=True,
        activity_types=["Sponsoring / Partenariats"],
    )
    category, _, regime, _, status = classify_tax_category(profile)
    assert category == "BIC"
    assert status == "confirmed"
    assert "Micro-BIC" in (regime or "")


def test_mixed_bic_services_and_vente():
    profile = UserProfile(
        registry_tax_base="BIC",
        rcs_registered=True,
        kbis_obtained=True,
        main_activity_commercial=True,
        has_secondary_activity=True,
        activity_types=["Sponsoring / Partenariats"],
        secondary_activity_types=["Vente de presets photo"],
    )
    category, reason, regime, plafond, status = classify_tax_category(profile)
    assert category == "mixed"
    assert status == "confirmed"
    assert "mixte" in reason.lower()
    assert "203 100" in (plafond or "")


def test_ape_code_not_used_for_classification():
    profile = UserProfile(
        ape_code="96.09Z",
        registry_tax_base="BNC",
        rcs_registered=False,
        kbis_obtained=False,
        main_activity_commercial=False,
        activity_types=["Sponsoring"],
    )
    category, _, _, _, _ = classify_tax_category(profile)
    assert category == "BNC"


def test_inconsistency_kbis_vs_user_declaration():
    profile = UserProfile(
        registry_tax_base="BIC",
        rcs_registered=True,
        kbis_obtained=True,
        main_activity_commercial=False,
    )
    msg = detect_fiscal_inconsistency(profile)
    assert msg is not None
    assert "rescrit" in msg.lower()


def test_finalize_blocks_on_inconsistency():
    profile = UserProfile(
        registry_tax_base="BIC",
        rcs_registered=True,
        kbis_obtained=True,
        main_activity_commercial=False,
        activity_types=["Sponsoring"],
        has_secondary_activity=False,
        revenue_sources=["YouTube"],
        international_clients=False,
        currencies=["EUR"],
        estimated_monthly_revenue="2000",
        estimated_annual_revenue="24000",
        revenue_variability="stable",
        invoices_already_issued=True,
        has_recurring_contracts=False,
        in_kind_gifts=False,
        first_income_date="1 an",
        sirene_document_uploaded=True,
        verification_status="verified",
    )
    out = finalize_profile(profile)
    assert out.fiscal_classification_status == "requires_expert"
    assert out.tax_category is None
    assert out.activity_mismatch is True
