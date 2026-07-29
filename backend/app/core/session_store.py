"""MongoDB-backed session store for orchestrator state."""

from __future__ import annotations

import asyncio
import threading
import uuid
from datetime import datetime, timezone

from app.core.mongo import sessions_collection
from app.core.users import sync_agent_context_from_state
from app.schemas.orchestrator import OrchestratorState, UserProfile

_lock = threading.Lock()
_initialized = False


def _ensure_schema() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        collection = sessions_collection()
        collection.create_index("id", unique=True)
        collection.create_index("updated_at")
        collection.create_index("user_id")
        _initialized = True


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def create_session(*, user_id: str | None = None) -> str:
    _ensure_schema()
    session_id = str(uuid.uuid4())
    now = _now_utc()
    state = OrchestratorState(
        session_id=session_id,
        phase="verification",
        profile=UserProfile(),
        user_id=user_id,
    )
    state_json = state.model_dump(mode="json")
    with _lock:
        sessions_collection().insert_one(
            {
                "id": session_id,
                "user_id": user_id,
                "state_json": state_json,
                "created_at": now,
                "updated_at": now,
            }
        )
    return session_id


def get_session(session_id: str) -> OrchestratorState | None:
    _ensure_schema()
    with _lock:
        row = sessions_collection().find_one(
            {"id": session_id},
            {"_id": 0, "state_json": 1},
        )
    if row is None:
        return None
    return OrchestratorState.model_validate(row["state_json"])


def save_session(session_id: str, state: OrchestratorState) -> None:
    _ensure_schema()
    now = _now_utc()
    state_json = state.model_dump(mode="json")
    with _lock:
        sessions_collection().update_one(
            {"id": session_id},
            {
                "$set": {
                    "state_json": state_json,
                    "user_id": state.user_id,
                    "updated_at": now,
                }
            },
        )
    # Keep durable intake/guidance context on the user for next features
    sync_agent_context_from_state(state)


def list_sessions_for_user(user_id: str, *, limit: int = 20) -> list[dict]:
    _ensure_schema()
    with _lock:
        rows = list(
            sessions_collection()
            .find({"user_id": user_id}, {"_id": 0, "id": 1, "updated_at": 1, "state_json": 1})
            .sort("updated_at", -1)
            .limit(limit)
        )
    out: list[dict] = []
    for row in rows:
        state = row.get("state_json") or {}
        updated = row.get("updated_at")
        out.append(
            {
                "session_id": row.get("id"),
                "branch": state.get("branch"),
                "phase": state.get("phase"),
                "updated_at": updated.isoformat() if isinstance(updated, datetime) else str(updated or ""),
            }
        )
    return out


async def async_create_session(*, user_id: str | None = None) -> str:
    return await asyncio.to_thread(create_session, user_id=user_id)


async def async_get_session(session_id: str) -> OrchestratorState | None:
    return await asyncio.to_thread(get_session, session_id)


async def async_save_session(session_id: str, state: OrchestratorState) -> None:
    await asyncio.to_thread(save_session, session_id, state)


async def async_list_sessions_for_user(user_id: str, *, limit: int = 20) -> list[dict]:
    return await asyncio.to_thread(list_sessions_for_user, user_id, limit=limit)
