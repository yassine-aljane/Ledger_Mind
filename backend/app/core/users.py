"""MongoDB user store + agent-context sync for intake / guidance."""

from __future__ import annotations

import asyncio
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from app.core.mongo import users_collection
from app.core.security import hash_password, verify_password
from app.schemas.auth import BranchAgentContext, UserAgentContext, UserPublic
from app.schemas.orchestrator import OrchestratorState

_lock = threading.Lock()
_initialized = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_indexes() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        col = users_collection()
        col.create_index("email", unique=True)
        col.create_index("id", unique=True)
        _initialized = True


def _doc_to_public(doc: dict[str, Any]) -> UserPublic:
    ctx_raw = doc.get("agent_context") or {}
    created = doc.get("created_at")
    if isinstance(created, datetime):
        created_s = created.isoformat()
    else:
        created_s = str(created or "")
    return UserPublic(
        id=doc["id"],
        email=doc["email"],
        name=doc.get("name") or "",
        created_at=created_s,
        agent_context=UserAgentContext.model_validate(ctx_raw),
    )


def create_user(*, email: str, password: str, name: str) -> UserPublic:
    _ensure_indexes()
    email_norm = email.strip().lower()
    now = _now()
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": email_norm,
        "name": name.strip(),
        "password_hash": hash_password(password),
        "created_at": now,
        "updated_at": now,
        "agent_context": UserAgentContext().model_dump(mode="json"),
    }
    with _lock:
        if users_collection().find_one({"email": email_norm}, {"_id": 1}):
            raise ValueError("Un compte existe déjà avec cet email.")
        users_collection().insert_one(doc)
    return _doc_to_public(doc)


def authenticate_user(*, email: str, password: str) -> UserPublic | None:
    _ensure_indexes()
    email_norm = email.strip().lower()
    with _lock:
        doc = users_collection().find_one({"email": email_norm}, {"_id": 0})
    if not doc:
        return None
    if not verify_password(password, doc.get("password_hash") or ""):
        return None
    return _doc_to_public(doc)


def get_user_by_id(user_id: str) -> UserPublic | None:
    _ensure_indexes()
    with _lock:
        doc = users_collection().find_one({"id": user_id}, {"_id": 0})
    if not doc:
        return None
    return _doc_to_public(doc)


def _branch_snapshot(state: OrchestratorState) -> BranchAgentContext:
    branch = state.branch if state.branch in ("intake", "guidance") else "intake"
    snap = BranchAgentContext(
        last_session_id=state.session_id,
        phase=state.phase,
        updated_at=_now().isoformat(),
        completeness=state.profile_completeness,
        recommended_regime=state.profile.recommended_regime,
        profile=state.profile.model_dump(mode="json"),
    )
    if branch == "guidance":
        snap.diagnostic_profile = state.diagnostic_profile.model_dump(mode="json")
        snap.roadmap = state.roadmap
    return snap


def sync_guidance_snapshot(
    user_id: str, *, session_id: str, phase: str, profil: dict,
    roadmap: dict | None, completeness: float,
) -> None:
    """Persiste le snapshot de la branche guidance sur le compte utilisateur.

    La guidance conversationnelle vit dans sa propre mémoire (`conversation_store.py`, jamais
    dans `OrchestratorState`/`sessions`), donc `sync_agent_context_from_state` (branche intake)
    ne la voit jamais : sans cet appel, `agent_context.guidance` restait vide pour TOUJOURS pour
    un utilisateur guidance-only, même après une feuille de route complète — et
    `hasCompletedOnboarding()` côté frontend renvoyait donc toujours faux, renvoyant
    l'utilisateur au choix de branche au lieu de sa feuille de route à la reconnexion.
    """
    if not user_id:
        return
    _ensure_indexes()
    snap = BranchAgentContext(
        last_session_id=session_id, phase=phase, updated_at=_now().isoformat(),
        completeness=completeness, recommended_regime=profil.get("choix_parcours"),
        profile=profil, roadmap=roadmap,
    ).model_dump(mode="json")
    with _lock:
        users_collection().update_one(
            {"id": user_id},
            {"$set": {"agent_context.guidance": snap, "updated_at": _now()}},
        )


def sync_agent_context_from_state(state: OrchestratorState) -> None:
    """Persist intake/guidance snapshots on the user document for next features."""
    if not state.user_id:
        return
    _ensure_indexes()
    branch = state.branch if state.branch in ("intake", "guidance") else "intake"
    snap = _branch_snapshot(state).model_dump(mode="json")
    with _lock:
        users_collection().update_one(
            {"id": state.user_id},
            {
                "$set": {
                    f"agent_context.{branch}": snap,
                    "updated_at": _now(),
                }
            },
        )


async def async_create_user(*, email: str, password: str, name: str) -> UserPublic:
    return await asyncio.to_thread(create_user, email=email, password=password, name=name)


async def async_authenticate_user(*, email: str, password: str) -> UserPublic | None:
    return await asyncio.to_thread(authenticate_user, email=email, password=password)


async def async_get_user_by_id(user_id: str) -> UserPublic | None:
    return await asyncio.to_thread(get_user_by_id, user_id)


async def async_sync_agent_context_from_state(state: OrchestratorState) -> None:
    await asyncio.to_thread(sync_agent_context_from_state, state)
