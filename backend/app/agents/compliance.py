"""Deterministic compliance comparison — no LLM, no network."""

from app.agents.tax_classifier import ape_prefix_category, classify_activity_types
from app.schemas.orchestrator import (
    ComplianceAlert,
    Mismatch,
    RecommendedAction,
    UserProfile,
)


def _activity_types_implied_category(activity_types: list[str]) -> str | None:
    kinds = classify_activity_types(activity_types)
    if "service" in kinds and "commerce" in kinds:
        return "mixed"
    if "commerce" in kinds:
        return "BIC"
    if "service" in kinds:
        return "BNC"
    return None


def check_compliance(
    profile: UserProfile,
) -> tuple[bool, list[Mismatch], list[ComplianceAlert], list[RecommendedAction]]:
    """
    Three-way comparison, deterministic only:
      1. profile.activity_types (what the user says they do)
      2. profile.ape_code / activity_declared (registry)
      3. Required obligations derived from profile.tax_category + profile.legal_form
    """
    mismatches: list[Mismatch] = []
    alerts: list[ComplianceAlert] = []
    actions: list[RecommendedAction] = []
    step = 1

    declared_cat = _activity_types_implied_category(profile.activity_types)
    registry_cat = ape_prefix_category(profile.ape_code)

    activity_mismatch = False
    if declared_cat and registry_cat and declared_cat != registry_cat:
        if not (declared_cat == "mixed"):
            activity_mismatch = True
            mismatches.append(
                Mismatch(
                    field="activite_principale",
                    declared_value=declared_cat,
                    actual_value=registry_cat,
                    note=(
                        f"Votre activité déclarée ({declared_cat}) ne correspond pas "
                        f"au code APE {profile.ape_code} ({registry_cat})."
                    ),
                )
            )

    if profile.international_clients and not profile.currencies:
        alerts.append(
            ComplianceAlert(
                severity="warning",
                message=(
                    "Vous facturez des clients internationaux mais aucune devise de paiement "
                    "n'est renseignée — vérifiez vos obligations de TVA intracommunautaire."
                ),
            )
        )

    if profile.has_recurring_contracts and profile.invoices_already_issued is False:
        alerts.append(
            ComplianceAlert(
                severity="warning",
                message=(
                    "Vous avez des contrats récurrents mais n'émettez pas encore de factures — "
                    "risque de non-conformité comptable."
                ),
            )
        )

    if profile.in_kind_gifts and profile.tax_category == "BNC":
        alerts.append(
            ComplianceAlert(
                severity="info",
                message=(
                    "Les cadeaux en nature reçus de marques doivent être valorisés et déclarés "
                    "en BNC (avantage en nature)."
                ),
            )
        )

    if activity_mismatch:
        actions.append(
            RecommendedAction(
                step=step,
                title="Mettre à jour votre code APE",
                description=(
                    "Contactez le greffe ou modifiez votre activité sur le guichet unique "
                    "pour aligner votre code APE avec votre activité réelle."
                ),
            )
        )
        step += 1

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

    if profile.international_clients and profile.tax_category:
        actions.append(
            RecommendedAction(
                step=step,
                title="Vérifier vos obligations de TVA",
                description=(
                    "Clients internationaux détectés : vérifiez si vous devez vous immatriculer "
                    "à la TVA ou appliquer le mécanisme d'autoliquidation."
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
                    "Votre SIRET n'a pas pu être vérifié — confirmez votre statut "
                    "auprès de l'INSEE ou créez une nouvelle immatriculation."
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
