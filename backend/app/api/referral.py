"""API router for the referral agent (expert-comptable search + outreach)."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.core.users import users_collection
from app.schemas.auth import UserPublic

router = APIRouter(prefix="/api/referral", tags=["referral"])


class ReferralRequest(BaseModel):
    ville: str = Field(..., min_length=1)
    demande: str = Field(..., min_length=1)


class ReferralEmailResult(BaseModel):
    destinataire: str
    email: str | None = None
    objet: str
    corps: str
    statut: str


class ReferralResponse(BaseModel):
    status: str
    error: str | None = None
    emails: list[ReferralEmailResult] = []
    cabinets_count: int = 0


class ReferralHistoryEntry(BaseModel):
    ville: str
    demande: str
    status: str
    cabinets_count: int
    emails: list[ReferralEmailResult]
    created_at: str


def _run_referral_agent(
    ville: str,
    demande: str,
    user_name: str,
    user_regime: str,
    user_situation: str,
) -> dict[str, Any]:
    from app.agents.referral.orchestrator import orchestrator
    from app.agents.referral.state import AgentState

    initial_state: AgentState = {
        "ville": ville,
        "demande": demande,
        "user_info": {
            "nom": user_name,
            "statut": user_regime or "micro-entrepreneur",
            "situation_fiscale": user_situation or "Première année d'activité",
        },
        "comptables": [],
        "emails_generes": [],
        "error": None,
        "status": "en_cours",
    }
    return orchestrator.invoke(initial_state)


@router.post("/generate", response_model=ReferralResponse)
async def generate(
    payload: ReferralRequest,
    user: UserPublic = Depends(get_current_user),
):
    ctx = user.agent_context
    regime = (
        ctx.guidance.recommended_regime
        or ctx.intake.recommended_regime
        or ""
    )
    situation = ""
    for branch in (ctx.guidance, ctx.intake):
        if branch.profile and isinstance(branch.profile, dict):
            cat = branch.profile.get("tax_category") or ""
            if cat:
                situation = f"{cat}, {regime}" if regime else cat
                break

    try:
        result = await asyncio.to_thread(
            _run_referral_agent,
            payload.ville,
            payload.demande,
            user.name,
            regime,
            situation,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur agent referral : {e}")

    if result.get("status") == "echec":
        return ReferralResponse(status="echec", error=result.get("error"))

    emails = [
        ReferralEmailResult(
            destinataire=e["destinataire"],
            email=e.get("email"),
            objet=e["objet"],
            corps=e["corps"],
            statut=e["statut"],
        )
        for e in result.get("emails_generes", [])
    ]

    entry = {
        "ville": payload.ville,
        "demande": payload.demande,
        "status": "termine",
        "cabinets_count": len(result.get("comptables", [])),
        "emails": [e.model_dump() for e in emails],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await asyncio.to_thread(
        lambda: users_collection().update_one(
            {"id": user.id},
            {"$push": {"agent_context.referral.history": entry}},
        )
    )

    return ReferralResponse(
        status="termine",
        emails=emails,
        cabinets_count=len(result.get("comptables", [])),
    )


@router.get("/history", response_model=list[ReferralHistoryEntry])
async def history(user: UserPublic = Depends(get_current_user)):
    doc = await asyncio.to_thread(
        lambda: users_collection().find_one({"id": user.id}, {"agent_context.referral.history": 1})
    )
    if not doc:
        return []
    raw = (doc.get("agent_context") or {}).get("referral", {}).get("history", [])
    out: list[ReferralHistoryEntry] = []
    for e in raw:
        if "cabinets_count" not in e and "comptables_count" in e:
            e = {**e, "cabinets_count": e["comptables_count"]}
        out.append(ReferralHistoryEntry(**e))
    return out
