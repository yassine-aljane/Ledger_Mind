import httpx

from app.services.insee_sirene import fetch_sirene
from app.services.inpi_rne import fetch_rne
from app.services.recherche import fetch_company_by_siren
from app.schemas.verification import Mismatch, VerificationResult


async def run_verification_agent(siret: str, company_name: str | None = None) -> VerificationResult:
    """Vérifie un SIRET en croisant SIRENE et RNE sans passer par le LLM."""
    siret_clean = siret.replace(" ", "")
    siren = siret_clean[:9]

    # Fetch company data once from recherche-entreprises API
    try:
        company_data = await fetch_company_by_siren(siren)
        error_msg = None
    except httpx.HTTPError as e:
        company_data = None
        error_msg = str(e)

    # 1. Retrieve data using the single fetched payload
    if error_msg:
        sirene = {"found": False, "error": error_msg}
        rne = {"found": False, "error": error_msg}
    else:
        sirene = await fetch_sirene(siret_clean, company_data=company_data)
        rne = await fetch_rne(siren, company_data=company_data)

    # 2. If SIRENE not found → immediate not_verified
    if not sirene.get("found"):
        return VerificationResult(
            status="not_verified",
            siret=siret_clean,
            explanation="Le SIRET est introuvable dans la base SIRENE (INSEE). "
                        "Vérifiez que le numéro est correct et complet (14 chiffres).",
            next_action="Vérifiez le SIRET auprès du greffe ou sur societe.com.",
        )

    etat = sirene.get("etat_administratif", "")
    is_active = etat == "A"

    # 3. Build mismatches list
    mismatches: list[Mismatch] = []

    if rne.get("found"):
        # Compare activity codes (trim and uppercase for robustness)
        sirene_ape = (sirene.get("activite_principale") or "").strip().upper()
        rne_act = (rne.get("activite_declaree") or "").strip().upper()
        if sirene_ape and rne_act and sirene_ape != rne_act:
            mismatches.append(Mismatch(
                field="activite_principale",
                sirene_value=sirene_ape,
                rne_value=rne_act,
                note="Les codes d'activité diffèrent entre SIRENE et RNE.",
            ))

        if rne.get("radiee"):
            is_active = False
            mismatches.append(Mismatch(
                field="etat_administratif",
                sirene_value="actif" if etat == "A" else "inactif",
                rne_value="radiée",
                note="L'entité est radiée au RNE (INPI) alors que SIRENE l'indique autrement.",
            ))

    # 4. Determine final status and explanation
    if not is_active:
        status = "not_verified"
        expl_parts = ["L'entité est inactive ou radiée."]
        if etat == "F":
            expl_parts.append("SIRENE indique que l'établissement est fermé (état F).")
        if rne.get("found") and rne.get("radiee"):
            expl_parts.append("Le RNE confirme que la société est radiée.")
        explanation = " ".join(expl_parts)
        next_action = (
            "Contactez le greffe du tribunal de commerce pour plus d'informations "
            "sur l'état de cette entreprise."
        )
    else:
        status = "verified"
        name = sirene.get("denomination") or ""
        explanation = f"L'entité « {name} » est active et validée par SIRENE."
        if rne.get("found") and not mismatches:
            explanation += " Les données RNE (INPI) sont cohérentes."
        elif mismatches:
            explanation += f" Attention : {len(mismatches)} écart(s) détecté(s) entre SIRENE et RNE."
        next_action = None

    return VerificationResult(
        status=status,
        siret=siret_clean,
        denomination=sirene.get("denomination"),
        legal_form=rne.get("forme_juridique") if rne.get("found") else None,
        ape_code=sirene.get("activite_principale"),
        activity_declared=rne.get("activite_declaree") if rne.get("found") else None,
        creation_date=sirene.get("date_creation"),
        administrative_status="actif" if etat == "A" else "inactif",
        mismatches=mismatches,
        explanation=explanation,
        next_action=next_action,
    )