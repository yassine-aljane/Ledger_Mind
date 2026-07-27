"""
Tool: classify tax category from profile fields. No LLM, no network.

APE prefix mapping follows INSEE NAF Rev. 2. Maintenance:
https://www.insee.fr/fr/information/2406147
"""

from app.schemas.orchestrator import UserProfile

_SERVICE_KEYWORDS: dict[str, list[str]] = {
    "sponsoring": ["sponsor", "partenariat", "partnership"],
    "affiliation": ["affiliation", "affiliate"],
    "prestations": ["prestation", "service", "consulting", "conseil"],
    "ugc": ["ugc", "contenu", "content creation", "création de contenu"],
    "consulting": ["consulting", "conseil", "coaching"],
    "ads": ["pub", "ads", "publicité", "advertising"],
    "courses": ["formation", "course", "cours", "e-learning"],
}

_COMMERCE_KEYWORDS: dict[str, list[str]] = {
    "product sales": ["vente", "product", "produit", "e-commerce", "ecommerce", "boutique"],
    "dropshipping": ["dropship"],
    "physical goods": ["physique", "marchandise", "goods", "stock"],
}

_APE_PREFIX_CATEGORY: dict[str, str] = {
    "01": "BIC", "02": "BIC", "03": "BIC",
    "45": "BIC", "46": "BIC", "47": "BIC",
    "56": "BIC",
    "62": "BNC", "63": "BNC", "69": "BNC", "70": "BNC", "71": "BNC",
    "72": "BNC", "73": "BNC", "74": "BNC", "77": "BNC", "78": "BNC",
    "82": "BNC", "85": "BNC", "86": "BNC", "90": "BNC", "91": "BNC",
    "92": "BNC", "93": "BNC", "95": "BNC", "96": "BNC",
}


def ape_prefix_category(ape_code: str | None) -> str | None:
    if not ape_code:
        return None
    normalized = ape_code.strip().upper().replace(".", "").replace(" ", "")
    if len(normalized) < 2:
        return None
    return _APE_PREFIX_CATEGORY.get(normalized[:2])


def classify_activity_types(activity_types: list[str]) -> set[str]:
    kinds: set[str] = set()
    combined = " ".join(a.strip().lower() for a in activity_types)

    for keywords in _SERVICE_KEYWORDS.values():
        if any(kw in combined for kw in keywords):
            kinds.add("service")

    for keywords in _COMMERCE_KEYWORDS.values():
        if any(kw in combined for kw in keywords):
            kinds.add("commerce")

    return kinds


def classify_tax_category(profile: UserProfile) -> tuple[str, str, str, str]:
    """Returns (category, reason, recommended_regime, plafond)."""
    activity_kinds = classify_activity_types(profile.activity_types)
    ape_cat = ape_prefix_category(profile.ape_code)

    if "service" in activity_kinds and "commerce" in activity_kinds:
        category = "mixed"
    elif "commerce" in activity_kinds:
        category = "BIC"
    elif "service" in activity_kinds:
        category = "BNC"
    elif ape_cat == "BIC":
        category = "BIC"
    elif ape_cat == "BNC":
        category = "BNC"
    else:
        category = "BNC"

    activities_label = (
        ", ".join(profile.activity_types) if profile.activity_types else "activité non précisée"
    )

    if category == "mixed":
        reason = (
            f"Vos activités ({activities_label}) combinent prestations de services et ventes "
            f"de produits, imposées en régime mixte (BNC + BIC)."
        )
        recommended_regime = "Micro-BNC + Micro-BIC"
        plafond = "77 700 €/an (BNC) + 188 700 €/an (BIC vente)"
    elif category == "BNC":
        reason = (
            f"Vos activités ({activities_label}) relèvent des prestations de services, "
            f"imposées en BNC."
        )
        recommended_regime = "Micro-BNC"
        plafond = "77 700 €/an"
    else:
        reason = (
            f"Vos activités ({activities_label}) relèvent de la vente de biens ou du commerce, "
            f"imposées en BIC."
        )
        recommended_regime = "Micro-BIC"
        plafond = "188 700 €/an"

    return category, reason, recommended_regime, plafond
