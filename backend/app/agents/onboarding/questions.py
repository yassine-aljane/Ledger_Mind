"""
Deterministic question ordering + LLM-generated phrasing.

The ORDER in which fields are asked is fixed and rule-based (tax-relevant
priority), so behavior is consistent and testable. The LLM is only used to
phrase the question naturally and propose quick-reply options — never to
decide what to ask or in what order.
"""

import json
import logging
from openai import AsyncOpenAI

from app.config import settings
from app.schemas.onboarding import InfluencerProfile

logger = logging.getLogger(__name__)

FIELD_PRIORITY = [
    "activity_types",
    "revenue_sources",
    "international_clients",
    "currencies",
    "estimated_monthly_revenue",
    "revenue_variability",
    "invoices_already_issued",
    "has_recurring_contracts",
    "in_kind_gifts",
    "first_income_date",
]

_FIELD_DESCRIPTIONS = {
    "activity_types": "le type d'activité principale (sponsoring, affiliation, UGC, apparitions...)",
    "revenue_sources": "les plateformes ou sources d'où viennent ses revenus",
    "international_clients": "s'il/elle facture des clients ou plateformes étrangères",
    "currencies": "les devises dans lesquelles il/elle est payé(e)",
    "estimated_monthly_revenue": "une estimation de ses revenus mensuels",
    "revenue_variability": "si ses revenus sont stables ou irréguliers (pics ponctuels)",
    "invoices_already_issued": "s'il/elle émet déjà des factures",
    "has_recurring_contracts": "s'il/elle a des contrats récurrents avec des marques",
    "in_kind_gifts": "s'il/elle reçoit des cadeaux en nature de marques",
    "first_income_date": "depuis quand il/elle perçoit ces revenus",
}

_FALLBACK_QUESTIONS = {
    "activity_types": (
        "Quel est votre type d'activité principale (sponsoring, affiliation, vente de produits/UGC...) ?",
        ["Sponsoring / Partenariats", "Affiliation", "Vente de produits/services", "Prestations UGC"]
    ),
    "revenue_sources": (
        "Quelles sont vos principales sources de revenus ou plateformes ?",
        ["YouTube", "Instagram / TikTok", "Boutique / Site web", "Facturation directe"]
    ),
    "international_clients": (
        "Facturez-vous des clients ou plateformes basés à l'étranger ?",
        ["Oui (hors France)", "Non (France uniquement)"]
    ),
    "currencies": (
        "Dans quelles devises recevez-vous vos paiements ?",
        ["EUR uniquement", "EUR + USD", "Plusieurs devises"]
    ),
    "estimated_monthly_revenue": (
        "Quelle est votre estimation de revenus mensuels moyens ?",
        ["Moins de 1 000 €", "1 000 € – 3 000 €", "3 000 € – 7 000 €", "Plus de 7 000 €"]
    ),
    "revenue_variability": (
        "Vos revenus sont-ils plutôt stables ou irréguliers (pics de saisonnalité) ?",
        ["Stables chaque mois", "Irréguliers (pics ponctuels)"]
    ),
    "invoices_already_issued": (
        "Émettez-vous déjà des factures pour votre activité ?",
        ["Oui, régulièrement", "Parfois", "Non, jamais"]
    ),
    "has_recurring_contracts": (
        "Avez-vous des contrats récurrents (ex: abonnements/retainers avec des marques) ?",
        ["Oui, des contrats récurrents", "Non, prestations ponctuelles"]
    ),
    "in_kind_gifts": (
        "Recevez-vous des cadeaux ou dotations en nature de la part des marques ?",
        ["Oui, régulièrement", "Rarement", "Non"]
    ),
    "first_income_date": (
        "Depuis quand percevez-vous des revenus de cette activité ?",
        ["Moins de 6 mois", "6 à 12 mois", "Plus de 2 ans"]
    ),
}

_QUESTION_INSTRUCTION = """Tu es l'assistant d'onboarding de LedgerMind, une app fiscale pour créateurs
de contenu. Pose UNE seule question, en français simple et chaleureux, sans jargon,
pour connaître : {field_description}.

Profil actuel de l'utilisateur (déjà connu, ne redemande pas ça) :
{current_profile}

Réponds UNIQUEMENT avec un JSON de cette forme, sans texte autour :
{{"question": "...", "quick_replies": ["...", "...", "..."]}}

Les quick_replies doivent être 3 à 5 réponses courtes et plausibles, adaptées
au profil déjà connu (par exemple, si l'utilisateur a déjà dit qu'il fait du
sponsoring Instagram, adapte les options en conséquence)."""

_client = AsyncOpenAI(
    api_key=settings.mistral_api_key,
    base_url="https://api.mistral.ai/v1",
)


def next_missing_field(profile: InfluencerProfile) -> str | None:
    for field in FIELD_PRIORITY:
        if getattr(profile, field) in (None, []):
            return field
    return None


def completeness_ratio(profile: InfluencerProfile) -> float:
    filled = sum(1 for f in FIELD_PRIORITY if getattr(profile, f) not in (None, []))
    return filled / len(FIELD_PRIORITY)


async def generate_question_for_field(
    profile: InfluencerProfile, field: str
) -> tuple[str, list[str]]:
    fallback_q, fallback_qr = _FALLBACK_QUESTIONS.get(
        field, (f"Peux-tu me dire {_FIELD_DESCRIPTIONS.get(field, field)} ?", [])
    )

    prompt = _QUESTION_INSTRUCTION.format(
        field_description=_FIELD_DESCRIPTIONS.get(field, field),
        current_profile=profile.model_dump_json(),
    )

    try:
        response = await _client.chat.completions.create(
            model=settings.mistral_model.removeprefix("mistral/"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or ""
        data = json.loads(_strip_json_fences(raw))
        question = data.get("question") or fallback_q
        quick_replies = data.get("quick_replies") or fallback_qr
        return question, quick_replies
    except Exception as e:
        logger.warning("LLM call for question generation failed (%s). Using fallback for field '%s'.", e, field)
        return fallback_q, fallback_qr


def _strip_json_fences(text: str) -> str:
    return text.replace("```json", "").replace("```", "").strip()
