"""
Guidance agent — conversational profiling (branch B) + deterministic roadmap.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.agents.guidance.accompaniment import rediger_accompagnement
from app.agents.guidance.questions import (
    completeness_ratio,
    next_missing_field,
    question_for_field,
    to_roadmap_profil,
)
from app.agents.guidance.roadmap.parcours import build_roadmap
from app.agents.guidance.understand import understand_answer
from app.schemas.orchestrator import DiagnosticProfile, RecommendedAction, UserProfile

logger = logging.getLogger(__name__)


@dataclass
class DiagnosticQuestionResult:
    diagnostic_profile: DiagnosticProfile
    question: str | None
    quick_replies: list[str]
    completeness: float
    is_complete: bool
    field: str | None = None


@dataclass
class FinalizeResult:
    diagnostic_profile: DiagnosticProfile
    profile: UserProfile
    roadmap: dict
    message: str


def ask_next_question(diag: DiagnosticProfile) -> DiagnosticQuestionResult:
    missing = next_missing_field(diag)
    if missing is None:
        return DiagnosticQuestionResult(
            diagnostic_profile=diag,
            question=None,
            quick_replies=[],
            completeness=1.0,
            is_complete=True,
            field=None,
        )
    question, quick = question_for_field(missing)
    return DiagnosticQuestionResult(
        diagnostic_profile=diag,
        question=question,
        quick_replies=quick,
        completeness=completeness_ratio(diag),
        is_complete=False,
        field=missing,
    )


async def handle_answer(
    diag: DiagnosticProfile,
    last_question: str | None,
    user_answer: str | None,
    *,
    target_field: str | None = None,
) -> DiagnosticQuestionResult:
    if not (user_answer and last_question):
        return ask_next_question(diag)

    field = target_field or next_missing_field(diag)
    result = await understand_answer(
        diag,
        last_question,
        user_answer,
        target_field=field,
    )
    diag = result.profile

    if result.status != "ok" and field is not None:
        still = next_missing_field(diag)
        if still == field:
            preface = result.assistant_message or "Pas de souci — je reformule :"
            q, quick = question_for_field(field)
            return DiagnosticQuestionResult(
                diagnostic_profile=diag,
                question=f"{preface} {q}",
                quick_replies=quick,
                completeness=completeness_ratio(diag),
                is_complete=False,
                field=field,
            )

    return ask_next_question(diag)


def _actions_from_roadmap(roadmap: dict) -> list[RecommendedAction]:
    actions: list[RecommendedAction] = []
    for i, etape in enumerate(roadmap.get("etapes") or [], start=1):
        if not isinstance(etape, dict):
            continue
        title = etape.get("titre") or etape.get("title") or f"Étape {i}"
        desc = (
            etape.get("detail")
            or etape.get("texte")
            or etape.get("description")
            or ""
        )
        actions.append(
            RecommendedAction(step=i, title=str(title), description=str(desc)[:500])
        )
    return actions


async def finalize_diagnostic(
    diag: DiagnosticProfile,
    user_profile: UserProfile | None = None,
    *,
    user_tone: str = "",
) -> FinalizeResult:
    profil = to_roadmap_profil(diag)
    roadmap = build_roadmap(profil)
    bandeau = roadmap.get("bandeau") or {}
    titre = str(bandeau.get("titre") or roadmap.get("parcours") or "votre parcours")
    texte = str(bandeau.get("texte") or "").strip()

    message = await rediger_accompagnement(profil, roadmap, user_tone=user_tone)
    # Reject tiny / bare-label LLM outputs (e.g. just "Micro-entreprise")
    if len(message.strip()) < 60 or message.strip().lower() in {
        titre.lower(),
        str(roadmap.get("parcours") or "").lower(),
    }:
        message = (
            f"D'après vos réponses, le régime le plus adapté est « {titre} ». "
            + (f"{texte} " if texte else "")
            + "Consultez ci-dessous votre feuille de route personnalisée, étape par étape."
        )

    profile = user_profile or UserProfile()
    profile.verification_status = "skipped"
    profile.recommended_regime = titre
    seuil = roadmap.get("seuil_micro") or roadmap.get("seuil")
    if seuil is not None:
        try:
            profile.regime_plafond = f"{int(seuil):,} €".replace(",", " ")
        except (TypeError, ValueError):
            profile.regime_plafond = str(seuil)
    profile.recommended_actions = _actions_from_roadmap(roadmap)
    if diag.activite and not profile.activity_types:
        profile.activity_types = [diag.activite]
    if diag.ca_estime_annuel is not None and not profile.estimated_annual_revenue:
        profile.estimated_annual_revenue = f"{int(diag.ca_estime_annuel)} €"
    if diag.recoit_cadeaux is not None:
        profile.in_kind_gifts = diag.recoit_cadeaux

    return FinalizeResult(
        diagnostic_profile=diag,
        profile=profile,
        roadmap=roadmap,
        message=message,
    )
