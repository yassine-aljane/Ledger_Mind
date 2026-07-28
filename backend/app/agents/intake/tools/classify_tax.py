"""
Tool: classify tax category — Kbis/RCS test (step 2) + mixed activity (step 4).

NAF/APE is NOT used. Never auto-classify when fiscal_classification_status = requires_expert.
"""

from __future__ import annotations

from app.schemas.orchestrator import UserProfile

_COMMERCE_KEYWORDS = (
    "vente", "produit", "boutique", "e-commerce", "ecommerce", "dropship",
    "preset", "préréglage", "physique", "marchandise", "shop",
)
_SERVICE_KEYWORDS = (
    "sponsor", "partenariat", "affiliation", "ugc", "contenu", "prestation",
    "conseil", "formation", "consulting", "coaching", "service",
)

_MICRO_BNC_PLAFOND = "77 700 €/an"
_MICRO_BIC_VENTE_PLAFOND = "188 700 €/an"
_MICRO_BIC_SERVICE_PLAFOND = "77 700 €/an (services) + 188 700 €/an (vente)"
_MIXED_GLOBAL_PLAFOND = "203 100 €/an (dont services ≤ 83 600 €)"


def _activity_kinds(types: list[str]) -> set[str]:
    combined = " ".join(t.strip().lower() for t in types)
    kinds: set[str] = set()
    if any(kw in combined for kw in _COMMERCE_KEYWORDS):
        kinds.add("commerce")
    if any(kw in combined for kw in _SERVICE_KEYWORDS):
        kinds.add("service")
    return kinds


def detect_fiscal_inconsistency(profile: UserProfile) -> str | None:
    """Step 6 — contradiction between Kbis test and user declarations."""
    if profile.registry_tax_base is None:
        return None

    if profile.rcs_registered is True and profile.main_activity_commercial is False:
        return (
            "Inscription RCS confirmée (Kbis) mais activité déclarée non commerciale. "
            "Contactez votre SIE ou demandez un rescrit fiscal via impots.gouv.fr."
        )

    if profile.rcs_registered is False and profile.main_activity_commercial is True:
        return (
            "Extrait RNE seul (BNC attendu) mais activité déclarée commerciale. "
            "Contactez votre SIE ou demandez un rescrit fiscal via impots.gouv.fr."
        )

    return None


def _is_mixed_bic(profile: UserProfile) -> bool:
    if not profile.has_secondary_activity:
        return False
    primary_kinds = _activity_kinds(profile.activity_types)
    secondary_kinds = _activity_kinds(profile.secondary_activity_types)
    all_kinds = primary_kinds | secondary_kinds
    return "commerce" in all_kinds and "service" in all_kinds


def classify_tax_category(
    profile: UserProfile,
) -> tuple[str | None, str, str | None, str | None, str | None]:
    """Returns (category, reason, regime, plafond, fiscal_status)."""
    inconsistency = detect_fiscal_inconsistency(profile)
    if inconsistency:
        return None, inconsistency, None, None, "requires_expert"

    base = profile.registry_tax_base
    if base is None:
        return (
            None,
            "Classification en attente — complétez la vérification RCS/RNE (étape 2).",
            None,
            None,
            None,
        )

    if base == "BNC":
        category = "BNC"
        reason = (
            "Extrait RNE seul détecté — inscription RNE uniquement. Activité non commerciale, "
            "imposée en BNC (régime des bénéfices non commerciaux)."
        )
        recommended_regime = "Micro-BNC"
        plafond = _MICRO_BNC_PLAFOND
    elif _is_mixed_bic(profile):
        category = "mixed"
        reason = (
            "Activité mixte détectée : vos activités principales et secondaires combinent "
            "prestations de services (BIC services, 50 % abattement) et ventes de produits "
            "(BIC vente, 71 % abattement). Vérifiez sur formalites.entreprises.gouv.fr "
            "que les deux activités sont déclarées séparément."
        )
        recommended_regime = "Micro-BIC (services + vente)"
        plafond = _MIXED_GLOBAL_PLAFOND
    else:
        category = "BIC"
        kinds = _activity_kinds(profile.activity_types + profile.secondary_activity_types)
        if "commerce" in kinds and "service" not in kinds:
            reason = (
                "Kbis confirmé — activité commerciale inscrite au RCS. "
                "Ventes de biens / produits, imposées en BIC vente."
            )
            recommended_regime = "Micro-BIC (vente)"
            plafond = _MICRO_BIC_VENTE_PLAFOND
        else:
            reason = (
                "Kbis confirmé — activité commerciale inscrite au RCS. "
                "Prestations de services (partenariats, influence), imposées en BIC services."
            )
            recommended_regime = "Micro-BIC (services)"
            plafond = _MICRO_BIC_SERVICE_PLAFOND

    return category, reason, recommended_regime, plafond, "confirmed"
