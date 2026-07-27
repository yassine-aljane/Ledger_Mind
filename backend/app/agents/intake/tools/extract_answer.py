"""
Tool: normalize / merge profile field updates. No LLM.

Used after LLM understanding (or as deterministic fallback when LLM is down).
"""

from __future__ import annotations

import logging
import re
from typing import Any

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

LIST_FIELDS = {"activity_types", "revenue_sources", "currencies"}
BOOL_FIELDS = {"invoices_already_issued", "has_recurring_contracts", "in_kind_gifts", "international_clients"}

_CONFUSION_RE = re.compile(
    r"("
    r"pas\s+compris|compris\s+pas|comprends?\s+pas|pas\s+comprends?|"
    r"j['’]?ai\s+pas\s+compris|jai\s+pas\s+compris|"
    r"je\s+ne\s+comprends?\s+pas|"
    r"r[eé]p[eè]te|redis|reformule|clarifie|"
    r"c['’]?est\s+quoi|cest\s+quoi|\?\?\?|hein\b"
    r")",
    re.IGNORECASE,
)


def is_confused_answer(answer: str) -> bool:
    text = answer.strip()
    if not text:
        return True
    if text in ("?", "??", "???"):
        return True
    return bool(_CONFUSION_RE.search(text))


def _coerce_value(field: str, value: Any, current_profile: UserProfile) -> Any:
    if value is None:
        return None

    if field in LIST_FIELDS:
        existing = list(getattr(current_profile, field) or [])
        if isinstance(value, str):
            new_items = [v.strip() for v in value.split(",") if v.strip()]
        elif isinstance(value, list):
            new_items = [str(v).strip() for v in value if str(v).strip()]
        else:
            new_items = []
        combined = existing + [item for item in new_items if item not in existing]
        return combined or None

    if field in BOOL_FIELDS:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            val_lower = value.strip().lower()
            if val_lower in ("true", "oui", "yes", "1", "vrai"):
                return True
            if val_lower in ("false", "non", "no", "0", "faux"):
                return False
        return None

    if field == "revenue_variability":
        val_str = str(value).strip().lower()
        if "stable" in val_str:
            return "stable"
        if any(k in val_str for k in ("spiky", "irregular", "irrégulier", "pic", "variable")):
            return "spiky"
        if "unknown" in val_str:
            return "unknown"
        return None

    return str(value).strip() or None


def _value_from_raw_answer(field: str, last_answer: str, current_profile: UserProfile) -> Any:
    answer = last_answer.strip()
    ans_lower = answer.lower()

    if field in LIST_FIELDS:
        return _coerce_value(field, [answer], current_profile)

    if field in BOOL_FIELDS:
        if any(k in ans_lower for k in ("oui", "yes", "vrai", "régulièrement", "parfois", "chaque")):
            return True
        if any(k in ans_lower for k in ("non", "no", "faux", "jamais")):
            return False
        return None

    if field == "revenue_variability":
        return _coerce_value(field, answer, current_profile)

    return answer or None


def apply_updates(
    profile: UserProfile,
    updates: dict[str, Any],
    *,
    target_field: str | None = None,
    last_answer: str | None = None,
) -> UserProfile:
    """Merge LLM/raw updates into profile with type coercion."""
    profile_dict = profile.model_dump()

    for field, value in updates.items():
        if field not in _PROFILE_QUESTION_FIELDS:
            continue
        coerced = _coerce_value(field, value, profile)
        if coerced is not None:
            profile_dict[field] = coerced

    if target_field and target_field in _PROFILE_QUESTION_FIELDS and last_answer:
        curr = profile_dict.get(target_field)
        if curr in (None, [], ""):
            fallback = _value_from_raw_answer(target_field, last_answer, profile)
            if fallback is not None:
                profile_dict[target_field] = fallback

    try:
        return UserProfile.model_validate(profile_dict)
    except Exception as e:
        logger.error("Validation error when merging profile updates: %s", e)
        return profile


# Kept for older call sites / router compat
async def extract_fields_from_answer(
    profile: UserProfile,
    last_question: str,
    last_answer: str,
    target_field: str | None = None,
) -> UserProfile:
    del last_question
    if is_confused_answer(last_answer):
        return profile
    return apply_updates(profile, {}, target_field=target_field, last_answer=last_answer)
