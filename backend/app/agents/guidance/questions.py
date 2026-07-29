"""Deterministic diagnostic question set for branch B (no SIREN)."""

from __future__ import annotations

from app.schemas.orchestrator import DiagnosticProfile

FIELD_PRIORITY = [
    "activite",
    "ca_estime_annuel",
    "vend_produits",
    "ventilation",  # virtual: fills ca_prestations + ca_vente when vend_produits
    "recoit_cadeaux",
    "situation_actuelle",
    "anciennete",
    "ca_n_1_au_dessus_seuil",
]

_FALLBACK: dict[str, tuple[str, list[str]]] = {
    "activite": (
        "Quelle est votre activité principale "
        "(création de contenu, prestation freelance, vente de produits…) ?",
        ["Création de contenu", "Prestation freelance", "Vente de produits", "Mixte"],
    ),
    "ca_estime_annuel": (
        "Quel chiffre d'affaires annuel prévoyez-vous, même approximativement ?",
        ["Moins de 10 000 €", "10 000 – 30 000 €", "30 000 – 77 700 €", "Plus de 77 700 €"],
    ),
    "vend_produits": (
        "Vendez-vous aussi des produits ou du merch, en plus de vos prestations ?",
        ["Oui", "Non, uniquement des prestations"],
    ),
    "ventilation": (
        "Comment se répartit votre chiffre d'affaires entre prestations de services "
        "(cadeaux reçus inclus) et ventes de produits ?",
        ["Surtout prestations", "Moitié-moitié", "Surtout ventes"],
    ),
    "recoit_cadeaux": (
        "Recevez-vous des cadeaux, dotations ou produits gratuits de marques ?",
        ["Oui", "Non"],
    ),
    "situation_actuelle": (
        "Quelle est votre situation actuelle ?",
        ["Salarié", "Étudiant", "Demandeur d'emploi", "Indépendant", "Autre"],
    ),
    "anciennete": (
        "Depuis combien de temps percevez-vous des revenus liés à cette activité ?",
        ["Moins de 3 mois", "3 à 12 mois", "Plus d'un an", "Je débute cette année"],
    ),
    "ca_n_1_au_dessus_seuil": (
        "Votre chiffre d'affaires de l'an dernier dépassait-il déjà le plafond micro-entreprise ?",
        ["Oui", "Non", "Je débute / pas d'activité l'an dernier"],
    ),
}


def _needs_ventilation(p: DiagnosticProfile) -> bool:
    return bool(p.vend_produits) and (p.ca_prestations is None or p.ca_vente is None)


def _needs_durabilite(p: DiagnosticProfile) -> bool:
    """Ask N-1 history only when CA is known and likely above micro threshold."""
    if p.ca_estime_annuel is None:
        return False
    if p.ca_n_1_au_dessus_seuil is not None:
        return False
    if p.premiere_annee is True:
        return False
    # Rough gate: only ask when CA is material (> ~half of BNC plafond)
    return float(p.ca_estime_annuel) >= 40_000


def is_field_filled(profile: DiagnosticProfile, field: str) -> bool:
    if field == "ventilation":
        return not _needs_ventilation(profile)
    if field == "ca_n_1_au_dessus_seuil":
        if not _needs_durabilite(profile):
            return True
        return profile.ca_n_1_au_dessus_seuil is not None
    if field == "recoit_cadeaux":
        return profile.recoit_cadeaux is not None
    value = getattr(profile, field, None)
    if field == "activite":
        return bool(value and str(value).strip())
    if field == "ca_estime_annuel":
        return value is not None
    if field == "vend_produits":
        return value is not None
    if field in ("situation_actuelle", "anciennete"):
        return bool(value and str(value).strip())
    return value is not None


def next_missing_field(profile: DiagnosticProfile) -> str | None:
    for field in FIELD_PRIORITY:
        if field == "ventilation" and not profile.vend_produits:
            continue
        if field == "ca_n_1_au_dessus_seuil" and not _needs_durabilite(profile):
            continue
        if not is_field_filled(profile, field):
            return field
    return None


def completeness_ratio(profile: DiagnosticProfile) -> float:
    relevant: list[str] = []
    for f in FIELD_PRIORITY:
        if f == "ventilation" and not profile.vend_produits:
            continue
        if f == "ca_n_1_au_dessus_seuil" and not (
            profile.ca_n_1_au_dessus_seuil is not None or _needs_durabilite(profile)
        ):
            continue
        relevant.append(f)
    if not relevant:
        return 0.0
    filled = sum(1 for f in relevant if is_field_filled(profile, f))
    return filled / len(relevant)


def question_for_field(field: str) -> tuple[str, list[str]]:
    return _FALLBACK.get(
        field,
        ("Pouvez-vous préciser ?", []),
    )


def to_roadmap_profil(profile: DiagnosticProfile) -> dict:
    """Map DiagnosticProfile → dict expected by build_roadmap()."""
    data = profile.model_dump()
    # Engine accepts ca_estime_annuel; drop None-only noise
    return {k: v for k, v in data.items() if v is not None}
