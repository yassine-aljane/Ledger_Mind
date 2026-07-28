"""Tool: verify SIREN/SIRET — step 1 (identity) + auto RCS for commercial companies."""

import httpx

from app.agents.intake.tools.registry_analysis import analyze_registry
from app.services.inpi_rne import fetch_rne
from app.services.recherche import fetch_company_by_siren
from app.schemas.verification import Mismatch, VerificationResult


async def run_verification_service(siret: str, company_name: str | None = None) -> VerificationResult:
    del company_name
    identifier = siret.replace(" ", "")
    if len(identifier) not in (9, 14) or not identifier.isdigit():
        return VerificationResult(
            status="not_verified",
            siret=identifier,
            explanation=(
                "Le numéro saisi est invalide. Indiquez un SIREN (9 chiffres) "
                "ou un SIRET complet (14 chiffres)."
            ),
            next_action="Vérifiez votre numéro sur annuaire-entreprises.data.gouv.fr.",
        )

    siren = identifier[:9]

    try:
        company_data = await fetch_company_by_siren(siren)
        error_msg = None
    except httpx.HTTPError as e:
        company_data = None
        error_msg = str(e)

    if error_msg or not company_data:
        return VerificationResult(
            status="not_verified",
            siret=identifier,
            explanation="Le numéro est introuvable dans la base SIRENE (INSEE).",
            next_action="Vérifiez le numéro sur annuaire-entreprises.data.gouv.fr.",
        )

    identity = analyze_registry(company_data)
    rne = await fetch_rne(siren, company_data=company_data)

    resolved_siret = identifier
    if len(identifier) == 9:
        siege_siret = ((company_data.get("siege") or {}).get("siret") or "").replace(" ", "")
        if len(siege_siret) == 14:
            resolved_siret = siege_siret

    mismatches: list[Mismatch] = []
    if rne.get("found") and rne.get("radiee"):
        mismatches.append(
            Mismatch(
                field="etat_administratif",
                sirene_value="actif" if identity.is_active else "inactif",
                rne_value="radiée",
                note="L'entité est radiée au RNE (INPI).",
            )
        )

    if not identity.is_active:
        return VerificationResult(
            status="not_verified",
            siret=identifier,
            denomination=identity.denomination,
            legal_form=identity.legal_form,
            nature_juridique_code=identity.nature_juridique_code,
            is_entrepreneur_individuel=identity.is_entrepreneur_individuel,
            micro_eligible=identity.micro_eligible,
            registry_address=identity.registry_address,
            ape_code=identity.ape_code,
            activity_declared=identity.activity_declared,
            creation_date=identity.creation_date,
            administrative_status="inactif",
            registry_document_required=False,
            rcs_registered=identity.rcs_registered,
            registry_tax_base=identity.registry_tax_base,
            registry_tax_reason=identity.registry_tax_reason,
            mismatches=mismatches,
            explanation="L'entité est inactive ou radiée.",
            next_action="Contactez le greffe ou régularisez votre situation.",
        )

    name = identity.denomination or ""
    explanation_parts = [f"L'entité « {name} » est active et confirmée au registre."]

    if identity.micro_eligible:
        explanation_parts.append(
            "Entrepreneur individuel (personne physique) — éligible au régime micro."
        )
    elif identity.legal_form:
        explanation_parts.append(f"Forme juridique : {identity.legal_form}.")

    if identity.ape_code:
        explanation_parts.append(
            f"Code NAF {identity.ape_code} (usage statistique uniquement)."
        )

    if identity.registry_tax_base:
        explanation_parts.append(identity.registry_tax_reason)
    elif identity.registry_document_required:
        explanation_parts.append(
            "Prochaine étape : déposez votre Kbis ou extrait RNE pour vérification automatique BIC/BNC."
        )

    return VerificationResult(
        status="verified",
        siret=resolved_siret,
        denomination=identity.denomination,
        legal_form=identity.legal_form,
        nature_juridique_code=identity.nature_juridique_code,
        is_entrepreneur_individuel=identity.is_entrepreneur_individuel,
        micro_eligible=identity.micro_eligible,
        registry_address=identity.registry_address,
        ape_code=identity.ape_code,
        activity_declared=identity.activity_declared,
        creation_date=identity.creation_date,
        administrative_status="actif",
        registry_document_required=identity.registry_document_required,
        rcs_registered=identity.rcs_registered,
        registry_tax_base=identity.registry_tax_base,
        registry_tax_reason=identity.registry_tax_reason,
        mismatches=mismatches,
        explanation=" ".join(explanation_parts),
        next_action=None,
    )


run_verification_agent = run_verification_service
