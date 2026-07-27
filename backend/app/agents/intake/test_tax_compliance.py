"""Unit tests for intake tax + compliance tools."""

from app.agents.intake.tools.check_compliance import check_compliance
from app.agents.intake.tools.classify_tax import classify_tax_category
from app.agents.intake.agent import finalize_profile
from app.schemas.orchestrator import UserProfile


def test_pure_service_activities_bnc():
    profile = UserProfile(
        activity_types=["Sponsoring / Partenariats", "Prestations UGC"],
        ape_code="73.11Z",
    )
    category, reason, regime, plafond = classify_tax_category(profile)
    assert category == "BNC"
    assert "BNC" in reason
    assert regime == "Micro-BNC"
    assert "77 700" in plafond


def test_pure_commerce_activities_bic():
    profile = UserProfile(
        activity_types=["Dropshipping", "Vente de produits physiques"],
        ape_code="47.91B",
    )
    category, reason, regime, plafond = classify_tax_category(profile)
    assert category == "BIC"
    assert regime == "Micro-BIC"


def test_finalize_profile_fills_tax_category():
    profile = UserProfile(
        activity_types=["Sponsoring"],
        ape_code="73.11Z",
        invoices_already_issued=True,
    )
    out = finalize_profile(profile)
    assert out.tax_category == "BNC"
    assert out.recommended_regime == "Micro-BNC"
    assert out.tax_category_reason


def test_ape_mismatch_flagged():
    profile = UserProfile(
        activity_types=["Sponsoring / Partenariats"],
        ape_code="47.91B",
        tax_category="BNC",
        invoices_already_issued=True,
    )
    mismatch, mismatches, _, _ = check_compliance(profile)
    assert mismatch is True
    assert mismatches[0].declared_value == "BNC"
    assert mismatches[0].actual_value == "BIC"
