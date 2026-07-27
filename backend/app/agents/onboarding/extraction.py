"""
LLM-based extraction: given the current UserProfile, the last question
asked, and the user's free-text answer, extract only the fields we can
confidently fill in.

This is the ONLY place the LLM touches structured profile data. It must
never guess — if unsure, leave the field absent. All output is validated
against the Pydantic schema before being merged into the profile.
"""

import json
import logging
from typing import Any
from openai import AsyncOpenAI

from app.config import settings
from app.schemas.orchestrator import UserProfile

logger = logging.getLogger(__name__)

_PROFILE_QUESTION_FIELDS = {
    "activity_types",
    "revenue_sources",
    "currencies",
    "estimated_monthly_revenue",
    "revenue_variability",
    "invoices_already_issued",
    "first_income_date",
    "has_recurring_contracts",
    "in_kind_gifts",
    "international_clients",
}

_EXTRACTION_INSTRUCTION = """Tu extrais des informations structurées à partir de la réponse
d'un utilisateur, pour compléter son profil fiscal de créateur de contenu.

Profil actuel (JSON) :
{current_profile}

Question posée à l'utilisateur :
{last_question}

Réponse libre de l'utilisateur :
{last_answer}

Règles strictes :
- Ne renvoie QUE les champs que tu peux déduire avec confiance de cette réponse.
- N'invente jamais une valeur. Si ce n'est pas clair, omets le champ.
- Réponds UNIQUEMENT avec un objet JSON valide contenant les champs à mettre à jour,
  sans aucun texte ni commentaire autour.

Format exact des champs (RESPECTE STRICTEMENT LES TYPES) :
- activity_types: LISTE DE CHAINES (ex: ["Vente de produits/services", "Sponsoring"])
- revenue_sources: LISTE DE CHAINES (ex: ["YouTube", "Instagram", "Boutique en ligne"])
- currencies: LISTE DE CHAINES (ex: ["EUR", "USD"])
- estimated_monthly_revenue: CHAINE OU NULL (ex: "5 000 €" ou "10k-15k")
- revenue_variability: CHAINE OU NULL ("stable" | "spiky" | "unknown")
- invoices_already_issued: BOOLEEN OU NULL (true | false)
- first_income_date: CHAINE OU NULL (ex: "2023" ou "Moins de 6 mois")
- has_recurring_contracts: BOOLEEN OU NULL (true | false)
- in_kind_gifts: BOOLEEN OU NULL (true | false)
- international_clients: BOOLEEN OU NULL (true | false)
"""

_client = AsyncOpenAI(
    api_key=settings.mistral_api_key,
    base_url="https://api.mistral.ai/v1",
)

LIST_FIELDS = {"activity_types", "revenue_sources", "currencies"}
BOOL_FIELDS = {"invoices_already_issued", "has_recurring_contracts", "in_kind_gifts", "international_clients"}


def _normalize_extracted_dict(updates: dict[str, Any], current_profile: UserProfile) -> dict[str, Any]:
    normalized: dict[str, Any] = {}

    for field, value in updates.items():
        if field not in _PROFILE_QUESTION_FIELDS or value is None:
            continue

        if field in LIST_FIELDS:
            existing = list(getattr(current_profile, field) or [])
            if isinstance(value, str):
                new_items = [v.strip() for v in value.split(",") if v.strip()]
            elif isinstance(value, list):
                new_items = [str(v).strip() for v in value if str(v).strip()]
            else:
                new_items = []

            combined = existing + [item for item in new_items if item not in existing]
            if combined:
                normalized[field] = combined

        elif field in BOOL_FIELDS:
            if isinstance(value, bool):
                normalized[field] = value
            elif isinstance(value, str):
                val_lower = value.strip().lower()
                if val_lower in ("true", "oui", "yes", "1", "vrai"):
                    normalized[field] = True
                elif val_lower in ("false", "non", "no", "0", "faux"):
                    normalized[field] = False
            elif isinstance(value, (int, float)):
                normalized[field] = bool(value)

        elif field == "revenue_variability":
            val_str = str(value).strip().lower()
            if "stable" in val_str:
                normalized[field] = "stable"
            elif any(k in val_str for k in ("spiky", "irregular", "irrégulier", "pic", "variable")):
                normalized[field] = "spiky"
            else:
                normalized[field] = "unknown"

        else:
            normalized[field] = str(value).strip()

    return normalized


async def extract_fields_from_answer(
    profile: UserProfile,
    last_question: str,
    last_answer: str,
    target_field: str | None = None,
) -> UserProfile:
    prompt = _EXTRACTION_INSTRUCTION.format(
        current_profile=profile.model_dump_json(),
        last_question=last_question,
        last_answer=last_answer,
    )

    try:
        response = await _client.chat.completions.create(
            model=settings.mistral_model.removeprefix("mistral/"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or ""
    except Exception as e:
        logger.error("LLM call for extraction failed: %s", e)
        raw = "{}"

    try:
        raw_dict = json.loads(_strip_json_fences(raw))
    except (json.JSONDecodeError, TypeError) as e:
        logger.warning("Failed to parse extraction JSON from LLM: %s. Raw output: %r", e, raw)
        raw_dict = {}

    normalized = _normalize_extracted_dict(raw_dict, profile)

    profile_dict = profile.model_dump()
    profile_dict.update(normalized)

    if target_field and target_field in _PROFILE_QUESTION_FIELDS:
        curr_val = profile_dict.get(target_field)
        if curr_val in (None, [], ""):
            if target_field in LIST_FIELDS:
                profile_dict[target_field] = [last_answer.strip()]
            elif target_field in BOOL_FIELDS:
                ans_lower = last_answer.strip().lower()
                profile_dict[target_field] = any(
                    k in ans_lower for k in ("oui", "yes", "vrai", "régulièrement", "parfois", "chaque")
                )
            elif target_field == "revenue_variability":
                ans_lower = last_answer.strip().lower()
                profile_dict[target_field] = "stable" if "stable" in ans_lower else "spiky"
            else:
                profile_dict[target_field] = last_answer.strip()

    try:
        return UserProfile.model_validate(profile_dict)
    except Exception as e:
        logger.error("Validation error when constructing profile: %s. Dict was: %r", e, profile_dict)
        return profile


def _strip_json_fences(text: str) -> str:
    return text.replace("```json", "").replace("```", "").strip()
