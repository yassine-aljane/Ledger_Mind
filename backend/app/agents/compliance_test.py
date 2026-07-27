"""Unit tests for compliance — pure deterministic logic."""

from app.agents.compliance import check_compliance
from app.schemas.orchestrator import UserProfile


def test_ape_commerce_with_service_activities_flags_mismatch():
    profile = UserProfile(
        activity_types=["Sponsoring / Partenariats", "Prestations UGC"],
        ape_code="47.91B",
        tax_category="BNC",
        international_clients=False,
        invoices_already_issued=True,
    )
    activity_mismatch, mismatches, _alerts, _actions = check_compliance(profile)
    assert activity_mismatch is True
    assert len(mismatches) == 1
    assert mismatches[0].field == "activite_principale"
    assert mismatches[0].declared_value == "BNC"
    assert mismatches[0].actual_value == "BIC"


def test_no_mismatch_when_aligned():
    profile = UserProfile(
        activity_types=["Sponsoring / Partenariats"],
        ape_code="73.11Z",
        tax_category="BNC",
        international_clients=False,
        invoices_already_issued=True,
    )
    activity_mismatch, mismatches, _alerts, _actions = check_compliance(profile)
    assert activity_mismatch is False
    assert mismatches == []


def test_international_clients_without_currencies_warning():
    profile = UserProfile(
        activity_types=["Sponsoring"],
        ape_code="73.11Z",
        tax_category="BNC",
        international_clients=True,
        currencies=[],
        invoices_already_issued=True,
    )
    _mismatch, _mismatches, alerts, _actions = check_compliance(profile)
    assert any(a.severity == "warning" for a in alerts)
