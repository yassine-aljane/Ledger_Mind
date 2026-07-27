"""
Deterministic tax category classification — no LLM, no network.

APE prefix mapping follows INSEE NAF Rev. 2 section divisions commonly
relevant to freelance creators and digital workers. Maintenance: cross-check
against https://www.insee.fr/fr/information/2406147 when updating codes.
"""

from app.schemas.orchestrator import UserProfile

# Activity keyword → economic nature (used for activity_types matching)
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

# APE division prefix (2 digits) → expected fiscal category lean
# Source: INSEE NAF Rev. 2 — sections J (info), M (professionnel), G (commerce), etc.
_APE_PREFIX_CATEGORY: dict[str, str] = {
    "01": "BIC", "02": "BIC", "03": "BIC",  # agriculture → BIC for goods
    "45": "BIC", "46": "BIC", "47": "BIC",  # commerce
    "56": "BIC",  # restauration
    "62": "BNC",  # programmation, conseil IT
    "63": "BNC",  # services d'information
    "69": "BNC",  # activités juridiques/comptables
    "70": "BNC",  # sièges sociaux, conseil gestion
    "71": "BNC",  # architecture, ingénierie
    "72": "BNC",  # R&D
    "73": "BNC",  # publicité, études de marché
    "74": "BNC",  # autres activités spécialisées
    "77": "BNC",  # location
    "78": "BNC",  # emploi
    "82": "BNC",  # activités administratives
    "85": "BNC",  # enseignement
    "86": "BNC",  # santé
    "90": "BNC",  # arts, spectacles
    "91": "BNC",  # bibliothèques, musées
    "92": "BNC",  # jeux, paris
    "93": "BNC",  # sport, loisirs
    "95": "BNC",  # réparation
    "96": "BNC",  # services personnels
}


def ape_prefix_category(ape_code: str | None) -> str | None:
    """Map an APE/NAF code prefix to BNC or BIC lean, or None if unknown."""
    if not ape_code:
        return None
    normalized = ape_code.strip().upper().replace(".", "").replace(" ", "")
    if len(normalized) < 2:
        return None
    prefix = normalized[:2]
    return _APE_PREFIX_CATEGORY.get(prefix)


def _normalize_text(text: str) -> str:
    return text.strip().lower()


def classify_activity_types(activity_types: list[str]) -> set[str]:
    """Return {'service', 'commerce'} based on declared activity types."""
    kinds: set[str] = set()
    combined = " ".join(_normalize_text(a) for a in activity_types)

    for _label, keywords in _SERVICE_KEYWORDS.items():
        if any(kw in combined for kw in keywords):
            kinds.add("service")

    for _label, keywords in _COMMERCE_KEYWORDS.items():
        if any(kw in combined for kw in keywords):
            kinds.add("commerce")

    return kinds


def classify_tax_category(profile: UserProfile) -> tuple[str, str, str, str]:
    """
    Returns (category, reason, recommended_regime, plafond).
    Deterministic only. No network calls, no LLM calls.
    """
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
        # Default for creators without clear signal: BNC (prestations intellectuelles)
        category = "BNC"

    activities_label = ", ".join(profile.activity_types) if profile.activity_types else "activité non précisée"

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
