"""
Registry analysis from recherche-entreprises.api.gouv.fr (step 1 + step 2).

NAF/APE is stored for reference but does NOT determine BIC/BNC.
BIC vs BNC for EI is determined by RCS inscription (Kbis) vs RNE-only — verified
automatically via uploaded document OCR (no public API field for EI).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

TaxBase = Literal["BIC", "BNC"]

_EI_CODE = "1000"
_ASSOCIATION_CODE = "9220"
_COMMERCIAL_SOCIETY_PREFIXES = ("5", "6", "7")


@dataclass
class RegistryIdentity:
    siren: str
    denomination: str | None
    etat_administratif: str | None
    nature_juridique_code: str | None
    legal_form: str | None
    is_entrepreneur_individuel: bool
    micro_eligible: bool
    ape_code: str | None
    activity_declared: str | None
    creation_date: str | None
    registry_address: str | None
    is_active: bool
    registry_document_required: bool
    rcs_registered: bool | None
    registry_tax_base: TaxBase | None
    registry_tax_reason: str


def _is_commercial_society(nature_code: str | None) -> bool:
    if not nature_code:
        return False
    if nature_code == _EI_CODE or nature_code == _ASSOCIATION_CODE:
        return False
    return nature_code[0] in _COMMERCIAL_SOCIETY_PREFIXES or len(nature_code) == 4


def analyze_registry(company_data: dict) -> RegistryIdentity:
    siren = (company_data.get("siren") or "").replace(" ", "")
    complements = company_data.get("complements") or {}
    siege = company_data.get("siege") or {}

    nature_code = str(company_data.get("nature_juridique") or "").strip() or None
    is_ei = nature_code == _EI_CODE or bool(complements.get("est_entrepreneur_individuel"))
    etat = company_data.get("etat_administratif") or siege.get("etat_administratif")
    is_active = etat == "A"

    address_parts = [siege.get("adresse"), siege.get("code_postal"), siege.get("libelle_commune")]
    registry_address = " ".join(p for p in address_parts if p) or None
    micro_eligible = is_ei and is_active

    rcs_registered: bool | None = None
    registry_tax_base: TaxBase | None = None
    registry_tax_reason = ""
    registry_document_required = False

    if _is_commercial_society(nature_code):
        rcs_registered = True
        registry_tax_base = "BIC"
        registry_tax_reason = (
            "Forme juridique commerciale détectée au registre — inscription RCS confirmée, "
            "activité imposée en BIC."
        )
    elif is_ei and is_active:
        registry_document_required = True
        registry_tax_reason = (
            "Entrepreneur individuel confirmé. Déposez votre Kbis ou extrait RNE — "
            "nous détectons automatiquement l'inscription RCS (BIC) ou RNE seul (BNC)."
        )
    elif not is_active:
        registry_tax_reason = "Entité inactive ou radiée — régularisation requise avant classification."

    from app.services.inpi_rne import _map_nature_juridique

    return RegistryIdentity(
        siren=siren,
        denomination=company_data.get("nom_complet") or company_data.get("nom_raison_sociale"),
        etat_administratif=etat,
        nature_juridique_code=nature_code,
        legal_form=_map_nature_juridique(nature_code),
        is_entrepreneur_individuel=is_ei,
        micro_eligible=micro_eligible,
        ape_code=company_data.get("activite_principale"),
        activity_declared=company_data.get("activite_principale"),
        creation_date=company_data.get("date_creation"),
        registry_address=registry_address,
        is_active=is_active,
        registry_document_required=registry_document_required,
        rcs_registered=rcs_registered,
        registry_tax_base=registry_tax_base,
        registry_tax_reason=registry_tax_reason,
    )
