"""
LLM answer understanding for the Intake agent.

The model extracts fields and detects confusion / off-topic.
Clear answers (quick replies, concrete values) always advance even if the LLM
mis-labels them — deterministic fill is the safety net.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Literal

from app.agents.intake.llm import chat_json
from app.agents.intake.tools.extract_answer import apply_updates, is_confused_answer
from app.schemas.orchestrator import UserProfile

logger = logging.getLogger(__name__)

UnderstandStatus = Literal["ok", "confused", "off_topic", "unclear"]

_INSTRUCTION = """Tu analyses la réponse d'un créateur de contenu pour son profil fiscal LedgerMind.

Profil actuel (JSON) :
{current_profile}

Champ attendu pour cette question : {target_field}
Description du champ : {field_description}

Question posée :
{last_question}

Réponse de l'utilisateur :
{last_answer}

Décide le statut :
- "ok" : la réponse répond à la question (même approximativement) → remplis "updates"
- "confused" : n'a pas compris / demande reformulation (ex: "j'ai pas compris", "répète") → updates = {{}}
- "off_topic" : clairement hors sujet → updates = {{}}
- "unclear" : trop vague → updates = {{}}

IMPORTANT : si l'utilisateur choisit une option claire (ex: "Sponsoring / Partenariats",
"Oui", "EUR uniquement"), status DOIT être "ok".

Si status != "ok", mets dans "assistant_message" UNE courte phrase en français.
Sinon assistant_message = null.

Types updates (si status = "ok") :
- activity_types / revenue_sources / currencies : liste de chaînes
- estimated_monthly_revenue / first_income_date : chaîne
- revenue_variability : "stable" | "spiky" | "unknown"
- invoices_already_issued / has_recurring_contracts / in_kind_gifts / international_clients : booléen

Réponds UNIQUEMENT avec un objet JSON (commence par {{) :
{{"status":"ok","assistant_message":null,"updates":{{"activity_types":["Sponsoring"]}}}}
"""

_FIELD_HINTS = {
    "activity_types": "type d'activité (sponsoring, affiliation, UGC, vente…)",
    "main_activity_commercial": "activité commerciale ou non (oui/non)",
    "has_secondary_activity": "activité secondaire en parallèle (oui/non)",
    "secondary_activity_types": "type d'activité secondaire (vente produits, conseil, formation…)",
    "revenue_sources": "sources / plateformes de revenus",
    "international_clients": "clients ou plateformes à l'étranger (oui/non)",
    "currencies": "devises de paiement",
    "estimated_monthly_revenue": "estimation revenus mensuels",
    "estimated_annual_revenue": "chiffre d'affaires annuel estimé",
    "revenue_variability": "revenus stables ou irréguliers",
    "invoices_already_issued": "émet déjà des factures (oui/non)",
    "has_recurring_contracts": "contrats récurrents (oui/non)",
    "in_kind_gifts": "cadeaux en nature (oui/non)",
    "first_income_date": "depuis quand les premiers revenus",
}


@dataclass
class UnderstandResult:
    status: UnderstandStatus
    profile: UserProfile
    assistant_message: str | None = None
    updates: dict[str, Any] = field(default_factory=dict)


def _field_filled(profile: UserProfile, target_field: str | None) -> bool:
    if not target_field:
        return False
    return getattr(profile, target_field) not in (None, [], "")


async def understand_answer(
    profile: UserProfile,
    last_question: str,
    last_answer: str,
    target_field: str | None,
) -> UnderstandResult:
    # Fast path: user explicitly confused → re-ask, do not fill
    if is_confused_answer(last_answer):
        logger.info("UNDERSTAND status=confused field=%s answer=%r (heuristic)", target_field, last_answer)
        return UnderstandResult(
            status="confused",
            profile=profile,
            assistant_message="Pas de souci — je reformule plus simplement.",
        )

    prompt = _INSTRUCTION.format(
        current_profile=profile.model_dump_json(),
        target_field=target_field or "inconnu",
        field_description=_FIELD_HINTS.get(target_field or "", target_field or ""),
        last_question=last_question,
        last_answer=last_answer,
    )

    data: dict[str, Any] | None = None
    try:
        data = await chat_json(prompt, temperature=0.0, max_tokens=1024)
    except Exception as e:
        logger.warning(
            "UNDERSTAND_LLM_FAILED error=%s: %s — deterministic fill",
            type(e).__name__,
            e,
        )

    if data is not None:
        status_raw = str(data.get("status") or "unclear").strip().lower()
        if status_raw not in ("ok", "confused", "off_topic", "unclear"):
            status_raw = "unclear"
        status: UnderstandStatus = status_raw  # type: ignore[assignment]
        assistant_message = data.get("assistant_message")
        if assistant_message is not None:
            assistant_message = str(assistant_message).strip() or None
        updates = data.get("updates") if isinstance(data.get("updates"), dict) else {}

        if status == "confused":
            return UnderstandResult(
                status="confused",
                profile=profile,
                assistant_message=assistant_message
                or "Pas de souci — je reformule plus simplement.",
            )

        if status == "ok":
            new_profile = apply_updates(
                profile, updates, target_field=target_field, last_answer=last_answer
            )
            logger.info(
                "UNDERSTAND status=ok field=%s updates=%s",
                target_field,
                list(updates.keys()),
            )
            return UnderstandResult(
                status="ok",
                profile=new_profile,
                assistant_message=None,
                updates=updates,
            )

        # LLM said off_topic/unclear — still try to fill if the answer looks usable
        filled = apply_updates(profile, {}, target_field=target_field, last_answer=last_answer)
        if _field_filled(filled, target_field):
            logger.info(
                "UNDERSTAND status=ok field=%s via deterministic override (llm said %s)",
                target_field,
                status,
            )
            return UnderstandResult(status="ok", profile=filled, updates={})

        logger.info(
            "UNDERSTAND status=%s field=%s answer=%r",
            status,
            target_field,
            last_answer,
        )
        return UnderstandResult(
            status=status,
            profile=profile,
            assistant_message=assistant_message,
        )

    # LLM down entirely → deterministic
    return _deterministic_fallback(profile, last_answer, target_field)


def _deterministic_fallback(
    profile: UserProfile,
    last_answer: str,
    target_field: str | None,
) -> UnderstandResult:
    new_profile = apply_updates(profile, {}, target_field=target_field, last_answer=last_answer)
    if _field_filled(new_profile, target_field):
        logger.info("UNDERSTAND status=ok field=%s via deterministic fallback", target_field)
        return UnderstandResult(status="ok", profile=new_profile)
    return UnderstandResult(
        status="unclear",
        profile=profile,
        assistant_message="Je n'ai pas bien saisi — peux-tu répondre plus clairement ?",
    )
