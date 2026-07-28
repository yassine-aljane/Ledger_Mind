"""Tool: compliance checks for onboarding/verification scope only. No LLM."""

from __future__ import annotations

from app.agents.intake.tools.classify_tax import detect_fiscal_inconsistency
from app.schemas.orchestrator import (
    ComplianceAlert,
    Mismatch,
    RecommendedAction,
    UserProfile,
)

# TVA franchise thresholds (services) — step 5, tracked by app from declared CA
_VAT_SERVICES_THRESHOLD = 37_500
_VAT_GOODS_THRESHOLD = 85_000


def _parse_revenue_eur(value: str | None) -> float | None:
    if not value:
        return None
    digits = "".join(c if c.isdigit() or c == "." else " " for c in value)
    parts = [p for p in digits.split() if p]
    if not parts:
        return None
    try:
        return float(parts[0])
    except ValueError:
        return None


def _annual_revenue_estimate(profile: UserProfile) -> float | None:
    if profile.estimated_annual_revenue:
        return _parse_revenue_eur(profile.estimated_annual_revenue)
    monthly = _parse_revenue_eur(profile.estimated_monthly_revenue)
    if monthly is not None:
        return monthly * 12
    return None


def check_compliance(
    profile: UserProfile,
) -> tuple[bool, list[Mismatch], list[ComplianceAlert], list[RecommendedAction]]:
    mismatches: list[Mismatch] = []
    alerts: list[ComplianceAlert] = []
    actions: list[RecommendedAction] = []
    step = 1
    activity_mismatch = False

    inconsistency = detect_fiscal_inconsistency(profile)
    if inconsistency:
        activity_mismatch = True
        mismatches.append(
            Mismatch(
                field="fiscal_classification",
                declared_value="déclaration utilisateur",
                actual_value=f"registre ({profile.registry_tax_base})",
                note=inconsistency,
            )
        )
        alerts.append(
            ComplianceAlert(
                severity="critical",
                message=inconsistency,
            )
        )
        actions.append(
            RecommendedAction(
                step=step,
                title="Contacter le SIE ou demander un rescrit fiscal",
                description=(
                    "Utilisez la messagerie sécurisée sur impots.gouv.fr pour obtenir "
                    "une réponse officielle avant de déclarer votre régime."
                ),
            )
        )
        return activity_mismatch, mismatches, alerts, actions

    if profile.has_secondary_activity and profile.tax_category == "mixed":
        alerts.append(
            ComplianceAlert(
                severity="warning",
                message=(
                    "Activité mixte : vérifiez sur formalites.entreprises.gouv.fr (Guichet Unique) "
                    "que vos activités principale et secondaire sont déclarées séparément."
                ),
            )
        )
        actions.append(
            RecommendedAction(
                step=step,
                title="Vérifier les déclarations au Guichet Unique",
                description=(
                    "Assurez-vous que chaque activité (services et vente) figure bien "
                    "dans votre dossier d'immatriculation."
                ),
            )
        )
        step += 1

    annual = _annual_revenue_estimate(profile)
    if annual is not None and profile.tax_category in ("BIC", "mixed"):
        threshold = _VAT_SERVICES_THRESHOLD
        if annual >= threshold * 0.8:
            alerts.append(
                ComplianceAlert(
                    severity="info" if annual < threshold else "warning",
                    message=(
                        f"CA annuel estimé ≈ {annual:,.0f} € — seuil franchise TVA services "
                        f"{threshold:,} €/an. "
                        + (
                            "Vous êtes encore sous la franchise."
                            if annual < threshold
                            else "Vous approchez ou dépassez le seuil — vérifiez vos obligations TVA."
                        )
                    ).replace(",", " "),
                )
            )

    if not profile.sirene_document_uploaded and profile.verification_status == "verified":
        alerts.append(
            ComplianceAlert(
                severity="warning",
                message=(
                    "Avis de situation SIRENE non archivé — téléchargez-le sur "
                    "avis-situation-sirene.insee.fr pour constituer votre dossier de preuve."
                ),
            )
        )

    if profile.invoices_already_issued is False:
        actions.append(
            RecommendedAction(
                step=step,
                title="Émettre les factures manquantes",
                description=(
                    "Mettez en place un système de facturation conforme avant votre "
                    "prochaine déclaration URSSAF."
                ),
            )
        )
        step += 1

    if profile.verification_status == "not_verified":
        actions.append(
            RecommendedAction(
                step=step,
                title="Régulariser votre immatriculation",
                description=(
                    "Votre SIREN/SIRET n'a pas pu être vérifié — confirmez votre statut "
                    "auprès de l'INSEE."
                ),
            )
        )
        step += 1

    if not actions and profile.tax_category:
        actions.append(
            RecommendedAction(
                step=1,
                title="Mettre en place le suivi mensuel",
                description=(
                    f"Déclarez vos revenus en {profile.recommended_regime or profile.tax_category} "
                    f"via LedgerMind pour rester conforme."
                ),
            )
        )

    return activity_mismatch, mismatches, alerts, actions
