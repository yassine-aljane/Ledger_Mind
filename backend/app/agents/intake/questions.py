"""
Deterministic question ordering + LLM-generated phrasing (Gemini).

Steps 4-5: activity, mixed activity, revenue data for VAT tracking.

Steps 6-8 (added): legal identity, precise fiscal category, VAT regime,
IR/foyer inputs required by the tax engine, ACRE, invoicing details,
and payment-reconciliation preferences required by the invoicing +
tax-report agents.
"""

import json
import logging

from app.llm.gemini import chat_json
from app.schemas.orchestrator import UserProfile

logger = logging.getLogger(__name__)

FIELD_PRIORITY = [
    "activity_types",
    "main_activity_commercial",
    "has_secondary_activity",
    "secondary_activity_types",
    "revenue_sources",
    "estimated_monthly_revenue",
    "estimated_annual_revenue",
    "international_clients",
    "currencies",
    "revenue_variability",
    "invoices_already_issued",
    "has_recurring_contracts",
    "in_kind_gifts",
    "first_income_date",
    # --- Added: legal identity & precise fiscal category (blocking for the tax engine) ---
    "fiscal_category",
    "bnc_caisse",
    "siret",
    "company_address",
    "activity_start_date",
    "location_zone",
    # --- Added: VAT regime ---
    "regime_tva",
    "numero_tva_intracommunautaire",
    # --- Added: IR / foyer inputs required by the tax calculation engine ---
    "versement_liberatoire",
    "rfr_n_minus_2",
    "family_status",
    "fiscal_parts",
    "other_household_income",
    # --- Added: ACRE ---
    "acre_active",
    "acre_start_date",
    # --- Added: invoicing details ---
    "invoicing_iban",
    "professional_liability_insurance",
    "rcs_rm_number",
    "default_payment_terms",
    "default_client_type",
    # --- Added: payment reconciliation preferences (invoicing + tax-report agents) ---
    "accepted_payment_methods",
    "manual_income_declaration_mode",
    "cumulative_revenue_current_year",
    "prior_threshold_breach_history",
]

_FIELD_DESCRIPTIONS = {
    "activity_types": "le type d'activité principale (sponsoring, affiliation, UGC, vente de produits…)",
    "main_activity_commercial": "si son activité principale est de nature commerciale (vente, partenariats rémunérés) ou non",
    "has_secondary_activity": "s'il/elle a une autre activité déclarée en parallèle (conseil, formation, vente de produits distincts)",
    "secondary_activity_types": "le type d'activité secondaire (vente de produits, conseil, formation…)",
    "revenue_sources": "les plateformes ou sources d'où viennent ses revenus",
    "estimated_monthly_revenue": "une estimation de ses revenus mensuels",
    "estimated_annual_revenue": "une estimation de son chiffre d'affaires annuel (pour le suivi des seuils TVA)",
    "international_clients": "s'il/elle facture des clients ou plateformes étrangères",
    "currencies": "les devises dans lesquelles il/elle est payé(e)",
    "revenue_variability": "si ses revenus sont stables ou irréguliers (pics ponctuels)",
    "invoices_already_issued": "s'il/elle émet déjà des factures",
    "has_recurring_contracts": "s'il/elle a des contrats récurrents avec des marques",
    "in_kind_gifts": "s'il/elle reçoit des cadeaux en nature de marques",
    "first_income_date": "depuis quand il/elle perçoit ces revenus",
    # --- Added ---
    "fiscal_category": (
        "la catégorie fiscale exacte de son activité (vente de marchandises, "
        "prestation de service commerciale, ou activité libérale/BNC)"
    ),
    "bnc_caisse": "s'il/elle relève du régime général (SSI) ou de la CIPAV pour sa caisse de retraite",
    "siret": "son numéro SIRET",
    "company_address": "l'adresse de son siège d'activité",
    "activity_start_date": "la date de création de son activité",
    "location_zone": "s'il/elle exerce en métropole ou dans un DOM",
    "regime_tva": "s'il/elle est en franchise en base de TVA ou déjà assujetti(e)",
    "numero_tva_intracommunautaire": "s'il/elle dispose d'un numéro de TVA intracommunautaire",
    "versement_liberatoire": "s'il/elle a opté pour le versement libératoire de l'impôt sur le revenu",
    "rfr_n_minus_2": "son revenu fiscal de référence (RFR) de l'année N-2",
    "family_status": "sa situation familiale (célibataire, marié(e), pacsé(e))",
    "fiscal_parts": "le nombre de parts fiscales de son foyer",
    "other_household_income": "le montant des autres revenus de son foyer (hors activité micro-entreprise)",
    "acre_active": "s'il/elle bénéficie de l'ACRE",
    "acre_start_date": "la date de début de son ACRE",
    "invoicing_iban": "l'IBAN à afficher sur ses factures pour le règlement",
    "professional_liability_insurance": "s'il/elle a une assurance responsabilité civile professionnelle",
    "rcs_rm_number": "s'il/elle est inscrit(e) au RCS ou au Répertoire des Métiers",
    "default_payment_terms": "le délai de paiement par défaut qu'il/elle souhaite appliquer sur ses factures",
    "default_client_type": "s'il/elle facture plutôt des particuliers, des professionnels, ou les deux",
    "accepted_payment_methods": (
        "les moyens de paiement qu'il/elle accepte (virement, espèces, carte, plateforme tierce…)"
    ),
    "manual_income_declaration_mode": (
        "comment il/elle souhaite déclarer manuellement les encaissements hors virement bancaire"
    ),
    "cumulative_revenue_current_year": (
        "son chiffre d'affaires encaissé cumulé depuis le début de l'année en cours"
    ),
    "prior_threshold_breach_history": (
        "s'il/elle a déjà dépassé le plafond de chiffre d'affaires lors d'une année précédente"
    ),
}

_FALLBACK_QUESTIONS = {
    "activity_types": (
        "Quel est votre type d'activité principale (sponsoring, affiliation, vente de produits/UGC…) ?",
        ["Sponsoring / Partenariats", "Affiliation", "Vente de produits/services", "Prestations UGC"],
    ),
    "main_activity_commercial": (
        "Votre activité principale est-elle de nature commerciale "
        "(partenariats rémunérés, vente, monétisation directe) ?",
        ["Oui, activité commerciale", "Non, activité non commerciale (artistique/libérale)"],
    ),
    "has_secondary_activity": (
        "Avez-vous une autre activité déclarée en parallèle "
        "(conseil, formation, vente de produits distincts comme des presets, merch…) ?",
        ["Oui, une activité secondaire", "Non, une seule activité"],
    ),
    "secondary_activity_types": (
        "Quelle est votre activité secondaire ?",
        [
            "Vente de produits / presets / merch",
            "Conseil / coaching",
            "Formation / cours",
            "Autre prestation de services",
        ],
    ),
    "revenue_sources": (
        "Quelles sont vos principales sources de revenus ou plateformes ?",
        ["YouTube", "Instagram / TikTok", "Boutique / Site web", "Facturation directe"],
    ),
    "estimated_monthly_revenue": (
        "Quelle est votre estimation de revenus mensuels moyens ?",
        ["Moins de 1 000 €", "1 000 € – 3 000 €", "3 000 € – 7 000 €", "Plus de 7 000 €"],
    ),
    "estimated_annual_revenue": (
        "Quel est votre chiffre d'affaires annuel estimé (pour le suivi des seuils TVA) ?",
        ["Moins de 10 000 €", "10 000 € – 37 500 €", "37 500 € – 77 700 €", "Plus de 77 700 €"],
    ),
    "international_clients": (
        "Facturez-vous des clients ou plateformes basés à l'étranger ?",
        ["Oui (hors France)", "Non (France uniquement)"],
    ),
    "currencies": (
        "Dans quelles devises recevez-vous vos paiements ?",
        ["EUR uniquement", "EUR + USD", "Plusieurs devises"],
    ),
    "revenue_variability": (
        "Vos revenus sont-ils plutôt stables ou irréguliers (pics de saisonnalité) ?",
        ["Stables chaque mois", "Irréguliers (pics ponctuels)"],
    ),
    "invoices_already_issued": (
        "Émettez-vous déjà des factures pour votre activité ?",
        ["Oui, régulièrement", "Parfois", "Non, jamais"],
    ),
    "has_recurring_contracts": (
        "Avez-vous des contrats récurrents (ex: abonnements/retainers avec des marques) ?",
        ["Oui, des contrats récurrents", "Non, prestations ponctuelles"],
    ),
    "in_kind_gifts": (
        "Recevez-vous des cadeaux ou dotations en nature de la part des marques ?",
        ["Oui, régulièrement", "Rarement", "Non"],
    ),
    "first_income_date": (
        "Depuis quand percevez-vous des revenus de cette activité ?",
        ["Moins de 6 mois", "6 à 12 mois", "Plus de 2 ans"],
    ),
    # --- Added: identity & precise fiscal category ---
    "fiscal_category": (
        "Votre activité relève-t-elle plutôt de la vente de marchandises, d'une prestation "
        "de service commerciale, ou d'une activité libérale ?",
        ["Vente de marchandises", "Prestation de service commerciale", "Activité libérale (BNC)"],
    ),
    "bnc_caisse": (
        "Pour votre retraite, relevez-vous du régime général (SSI) ou de la CIPAV ?",
        ["Régime général (SSI)", "CIPAV", "Je ne sais pas"],
    ),
    "siret": (
        "Quel est votre numéro SIRET (14 chiffres) ?",
        [],
    ),
    "company_address": (
        "Quelle est l'adresse de votre siège d'activité ?",
        [],
    ),
    "activity_start_date": (
        "À quelle date avez-vous créé votre activité ?",
        [],
    ),
    "location_zone": (
        "Exercez-vous votre activité en métropole ou dans un DOM (Guadeloupe, Martinique, Guyane, "
        "Réunion, Mayotte) ?",
        ["Métropole", "DOM"],
    ),
    # --- Added: VAT regime ---
    "regime_tva": (
        "Êtes-vous actuellement en franchise en base de TVA (vous ne facturez pas de TVA) ?",
        ["Oui, franchise en base", "Non, je facture de la TVA"],
    ),
    "numero_tva_intracommunautaire": (
        "Avez-vous un numéro de TVA intracommunautaire ?",
        ["Oui", "Non"],
    ),
    # --- Added: IR / foyer ---
    "versement_liberatoire": (
        "Avez-vous opté pour le versement libératoire de l'impôt sur le revenu ?",
        ["Oui", "Non", "Je ne sais pas"],
    ),
    "rfr_n_minus_2": (
        "Quel est le revenu fiscal de référence (RFR) de votre foyer pour l'année N-2 ?",
        [],
    ),
    "family_status": (
        "Quelle est votre situation familiale ?",
        ["Célibataire", "Marié(e)", "Pacsé(e)"],
    ),
    "fiscal_parts": (
        "Combien de parts fiscales compte votre foyer ?",
        ["1", "1,5", "2", "2,5 ou plus"],
    ),
    "other_household_income": (
        "Quel est le montant total des autres revenus de votre foyer, hors activité micro-entreprise ?",
        ["Aucun autre revenu", "Moins de 20 000 €", "20 000 € – 50 000 €", "Plus de 50 000 €"],
    ),
    # --- Added: ACRE ---
    "acre_active": (
        "Bénéficiez-vous actuellement de l'ACRE (aide à la création d'entreprise) ?",
        ["Oui", "Non", "Je ne sais pas"],
    ),
    "acre_start_date": (
        "À quelle date votre ACRE a-t-il/elle débuté ?",
        [],
    ),
    # --- Added: invoicing details ---
    "invoicing_iban": (
        "Quel IBAN souhaitez-vous afficher sur vos factures pour le règlement ?",
        [],
    ),
    "professional_liability_insurance": (
        "Avez-vous une assurance responsabilité civile professionnelle ?",
        ["Oui", "Non"],
    ),
    "rcs_rm_number": (
        "Êtes-vous inscrit(e) au RCS ou au Répertoire des Métiers ?",
        ["Oui", "Non"],
    ),
    "default_payment_terms": (
        "Quel délai de paiement souhaitez-vous appliquer par défaut sur vos factures ?",
        ["Paiement comptant", "15 jours", "30 jours", "45 jours"],
    ),
    "default_client_type": (
        "Facturez-vous plutôt des particuliers, des professionnels, ou les deux ?",
        ["Particuliers", "Professionnels", "Les deux"],
    ),
    # --- Added: payment reconciliation preferences ---
    "accepted_payment_methods": (
        "Quels moyens de paiement acceptez-vous de la part de vos clients ?",
        ["Virement bancaire uniquement", "Espèces", "Carte bancaire", "Plateforme tierce (Stripe, PayPal…)"],
    ),
    "manual_income_declaration_mode": (
        "Quand vous êtes payé(e) autrement que par virement, comment préférez-vous le déclarer dans l'outil ?",
        ["Saisie manuelle facture par facture", "Import groupé périodique", "Je ne sais pas encore"],
    ),
    "cumulative_revenue_current_year": (
        "Quel est votre chiffre d'affaires encaissé cumulé depuis le début de l'année en cours ?",
        [],
    ),
    "prior_threshold_breach_history": (
        "Avez-vous déjà dépassé le plafond de chiffre d'affaires lors d'une année précédente ?",
        ["Oui", "Non", "Je ne sais pas"],
    ),
}

_QUESTION_INSTRUCTION = """Tu es l'assistant d'onboarding de LedgerMind, une app fiscale pour créateurs
de contenu. Pose UNE seule question, en français simple et chaleureux, sans jargon,
pour connaître : {field_description}.

Profil actuel de l'utilisateur (déjà connu, ne redemande pas ça) :
{current_profile}

Réponds UNIQUEMENT avec un objet JSON brut (commence par {{, pas de markdown) :
{{"question": "...", "quick_replies": ["...", "...", "..."]}}

Les quick_replies doivent être 3 à 5 réponses courtes et plausibles, adaptées
au profil déjà connu.
"""


def _field_is_missing(profile: UserProfile, field: str) -> bool:
    # Question déjà posée, à laquelle l'utilisateur a répondu « je ne sais pas » : la reposer
    # ferait boucler l'onboarding. Une non-réponse consignée vaut mieux qu'une valeur inventée.
    if field in (profile.unknown_fields or []):
        return False

    if field == "secondary_activity_types":
        if profile.has_secondary_activity is not True:
            return False
    # --- Added: conditional fields, mirroring the pattern above ---
    if field == "bnc_caisse":
        if profile.fiscal_category != "BNC":
            return False
    if field == "acre_start_date":
        if profile.acre_active is not True:
            return False
    if field == "manual_income_declaration_mode":
        methods = profile.accepted_payment_methods
        if not methods:
            return False
        if list(methods) == ["Virement bancaire uniquement"]:
            return False

    if field not in UserProfile.model_fields:
        # Dérive entre `FIELD_PRIORITY` et le modèle. `test_intake_questionnaire.py` la fait
        # échouer en CI ; ici on la journalise et on passe, plutôt que d'interrompre
        # l'onboarding d'un utilisateur au milieu de son parcours.
        logger.error(
            "CHAMP_INCONNU field=%s : présent dans FIELD_PRIORITY mais absent de UserProfile",
            field,
        )
        return False
    return getattr(profile, field) in (None, [])


def next_missing_field(profile: UserProfile) -> str | None:
    for field in FIELD_PRIORITY:
        if _field_is_missing(profile, field):
            return field
    return None


def completeness_ratio(profile: UserProfile) -> float:
    applicable = [
        f
        for f in FIELD_PRIORITY
        if not (f == "secondary_activity_types" and profile.has_secondary_activity is not True)
        # --- Added: exclude conditional fields when not applicable, same logic as _field_is_missing ---
        and not (f == "bnc_caisse" and profile.fiscal_category != "BNC")
        and not (f == "acre_start_date" and profile.acre_active is not True)
        and not (
            f == "manual_income_declaration_mode"
            and profile.accepted_payment_methods
            and list(profile.accepted_payment_methods) == ["Virement bancaire uniquement"]
        )
    ]
    filled = sum(1 for f in applicable if not _field_is_missing(profile, f))
    return filled / len(applicable) if applicable else 1.0


async def generate_question_for_field(
    profile: UserProfile,
    field: str,
    verification_context: dict | None = None,
    *,
    preface: str | None = None,
) -> tuple[str, list[str]]:
    fallback_q, fallback_qr = _FALLBACK_QUESTIONS.get(
        field, (f"Peux-tu me dire {_FIELD_DESCRIPTIONS.get(field, field)} ?", [])
    )
    known = {
        k: getattr(profile, k, None)
        for k in FIELD_PRIORITY
        if getattr(profile, k, None) not in (None, [])
    }
    context_block = json.dumps(known, ensure_ascii=False)
    if verification_context:
        context_block += (
            f"\n\nContexte registre :\n{json.dumps(verification_context, ensure_ascii=False)}"
        )

    prompt = _QUESTION_INSTRUCTION.format(
        field_description=_FIELD_DESCRIPTIONS.get(field, field),
        current_profile=context_block,
    )

    try:
        data = await chat_json(prompt, temperature=0.4, max_tokens=1024)
        question = data.get("question")
        quick_replies = data.get("quick_replies")

        if not question or not quick_replies:
            logger.warning(
                "FALLBACK_QUESTION field=%s reason=empty_llm_payload data=%r",
                field,
                data,
            )

        question = question or fallback_q
        quick_replies = quick_replies or fallback_qr
    except Exception as e:
        logger.warning(
            "FALLBACK_QUESTION field=%s reason=llm_error error=%s: %s",
            field,
            type(e).__name__,
            e,
        )
        question, quick_replies = fallback_q, fallback_qr

    if preface:
        question = f"{preface.strip()}\n\n{question}"
    return question, quick_replies