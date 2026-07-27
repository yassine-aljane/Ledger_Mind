"""Unit tests for tax_classifier — pure deterministic logic."""

from app.agents.tax_classifier import classify_tax_category
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
    assert "BIC" in reason
    assert regime == "Micro-BIC"
    assert "188 700" in plafond


def test_mixed_activities():
    profile = UserProfile(
        activity_types=["Sponsoring", "Vente de produits"],
        ape_code="73.11Z",
    )
    category, reason, regime, _plafond = classify_tax_category(profile)
    assert category == "mixed"
    assert "mixte" in reason.lower() or "BNC" in reason
    assert "Micro-BNC" in regime


def test_ape_fallback_when_no_activity_types():
    profile = UserProfile(ape_code="62.01Z")
    category, _, regime, _ = classify_tax_category(profile)
    assert category == "BNC"
    assert regime == "Micro-BNC"
