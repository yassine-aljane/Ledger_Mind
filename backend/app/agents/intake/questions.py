"""
Deterministic question ordering + LLM-generated phrasing (Gemini).

Steps 4–5: activity, mixed activity, revenue data for VAT tracking.
"""

import json
import logging

from app.agents.intake.llm import chat_json
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
    if field == "secondary_activity_types":
        if profile.has_secondary_activity is not True:
            return False
    return getattr(profile, field) in (None, [])


def next_missing_field(profile: UserProfile) -> str | None:
    for field in FIELD_PRIORITY:
        if _field_is_missing(profile, field):
            return field
    return None


def completeness_ratio(profile: UserProfile) -> float:
    applicable = [
        f for f in FIELD_PRIORITY if f != "secondary_activity_types" or profile.has_secondary_activity is True
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
        k: getattr(profile, k)
        for k in FIELD_PRIORITY
        if getattr(profile, k) not in (None, [])
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
