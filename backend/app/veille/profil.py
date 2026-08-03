"""Profil de veille : ce qu'on sait d'un utilisateur, pour décider ce qui le concerne.

Le profil est reconstruit à partir des DEUX branches du produit :
  • branche A (intake) — SIREN vérifié, régime, TVA, périodicité URSSAF…
  • branche B (guidance) — diagnostic sans immatriculation : activité, CA estimé, régime visé

L'ancienne veille (`/api/echeancier/veille`) exigeait un SIREN vérifié et renvoyait 409 sinon.
Elle excluait donc tous les utilisateurs de la branche B — précisément ceux qui, n'étant pas
encore immatriculés, ont le plus besoin de savoir qu'une règle change. On accepte ici un profil
partiel : moins de champs connus signifie simplement moins de nouveautés retenues.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.schemas.auth import UserPublic

_MOTS_INFLUENCEUR = ("sponsoring", "affiliation", "ugc", "partenariat", "contenu", "influenc")
_MOTS_FREELANCE = ("freelance", "conseil", "prestation", "service")

#: Quel seuil surveille-t-on pour quelle catégorie fiscale.
_SEUILS_PAR_CATEGORIE = {
    "BNC": {"micro_bnc", "tva_franchise_services"},
    "BIC": {"micro_bic_vente", "micro_bic_service", "tva_franchise_vente"},
    "mixed": {
        "micro_bnc",
        "micro_bic_vente",
        "micro_bic_service",
        "tva_franchise_services",
        "tva_franchise_vente",
    },
}


@dataclass
class ProfilVeille:
    """Vue aplatie du profil, orientée filtrage.

    Un champ à `None` veut dire « inconnu », pas « faux » : un critère portant sur un champ
    inconnu ne peut ni retenir ni exclure une nouveauté avec certitude (voir `scoring`).
    """

    uid: str
    regime: str | None = None
    tax_category: str | None = None
    regime_tva: str | None = None
    international: bool | None = None
    periodicite_urssaf: str | None = None
    ape_code: str | None = None
    ca_estime: float | None = None
    activites: set[str] = field(default_factory=lambda: {"tous"})
    seuils_suivis: set[str] = field(default_factory=set)
    #: Ce qui a servi à bâtir le profil — sert à justifier un rattachement à l'utilisateur.
    champs_connus: set[str] = field(default_factory=set)

    @property
    def est_vide(self) -> bool:
        """Aucun champ discriminant : on ne peut rien personnaliser honnêtement."""
        return not self.champs_connus


def _activites_depuis(textes: str) -> set[str]:
    tags = {"tous"}
    bas = textes.lower()
    if any(mot in bas for mot in _MOTS_INFLUENCEUR):
        tags.add("influenceur")
    if any(mot in bas for mot in _MOTS_FREELANCE):
        tags.add("freelance")
    return tags


def _nombre(valeur) -> float | None:
    """Extrait un montant d'un champ qui peut être un nombre ou une chaîne (« 32 700 € / an »)."""
    if valeur is None:
        return None
    if isinstance(valeur, (int, float)):
        return float(valeur)
    chiffres = re.sub(r"[^\d]", "", str(valeur))
    return float(chiffres) if chiffres else None


def _slug(valeur: str | None) -> str | None:
    if not valeur:
        return None
    return re.sub(r"[^a-z0-9]+", "_", valeur.lower()).strip("_")


def construire_profil(user: UserPublic, profil_guidance: dict | None = None) -> ProfilVeille:
    """Fusionne intake et guidance. L'intake prime : il est vérifié, la guidance est déclarative."""
    profil = ProfilVeille(uid=user.id)
    textes: list[str] = []

    intake = getattr(getattr(user, "agent_context", None), "intake", None)
    brut = (getattr(intake, "profile", None) or {}) if intake else {}
    if isinstance(brut, dict) and brut:
        for champ, attribut in (
            ("recommended_regime", "regime"),
            ("tax_category", "tax_category"),
            ("regime_tva", "regime_tva"),
            ("periodicite_urssaf", "periodicite_urssaf"),
            ("ape_code", "ape_code"),
        ):
            valeur = brut.get(champ)
            if valeur:
                setattr(profil, attribut, _slug(valeur) if attribut == "regime" else valeur)
                profil.champs_connus.add(champ)

        if brut.get("international_clients") is not None:
            profil.international = bool(brut["international_clients"])
            profil.champs_connus.add("international_clients")
        if brut.get("revenus_intracommunautaires") is not None:
            profil.international = profil.international or bool(brut["revenus_intracommunautaires"])
            profil.champs_connus.add("revenus_intracommunautaires")

        ca = _nombre(brut.get("estimated_annual_revenue"))
        if ca is not None:
            profil.ca_estime = ca
            profil.champs_connus.add("estimated_annual_revenue")

        textes += (brut.get("activity_types") or []) + (brut.get("secondary_activity_types") or [])

    if profil_guidance:
        if not profil.regime and profil_guidance.get("regime_actuel"):
            profil.regime = _slug(profil_guidance["regime_actuel"])
            profil.champs_connus.add("regime_actuel")
        if profil.ca_estime is None:
            ca = _nombre(profil_guidance.get("ca_estime"))
            if ca is not None:
                profil.ca_estime = ca
                profil.champs_connus.add("ca_estime")
        if profil_guidance.get("activite"):
            textes.append(str(profil_guidance["activite"]))
            profil.champs_connus.add("activite")
        # Vendre des produits fait relever du BIC : c'est le seul indice de catégorie que la
        # branche B fournit avant toute classification fiscale.
        if profil.tax_category is None and profil_guidance.get("vend_produits") is not None:
            profil.tax_category = "BIC" if profil_guidance["vend_produits"] else "BNC"
            profil.champs_connus.add("vend_produits")

    if textes:
        profil.activites = _activites_depuis(" ".join(textes))
        profil.champs_connus.add("activity_types")

    if profil.tax_category:
        profil.seuils_suivis = set(_SEUILS_PAR_CATEGORIE.get(profil.tax_category, set()))
    if profil.regime_tva == "franchise":
        profil.seuils_suivis |= {"tva_franchise_services", "tva_franchise_vente"}
    if profil.periodicite_urssaf:
        profil.seuils_suivis.add("urssaf")

    return profil
