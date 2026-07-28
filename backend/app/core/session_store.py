"""MongoDB-backed session store for orchestrator state."""

import asyncio
import threading
import uuid
from datetime import datetime, timezone

from pymongo import MongoClient
from pymongo.collection import Collection

from app.config import settings
from app.schemas.orchestrator import OrchestratorState, UserProfile

_lock = threading.Lock()
_initialized = False
_client: MongoClient | None = None


def _collection() -> Collection:
    global _client
    if _client is None:
        _client = MongoClient(settings.mongo_uri)
    return _client[settings.mongo_db_name]["sessions"]


def _ensure_schema() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        collection = _collection()
        collection.create_index("id", unique=True)
        collection.create_index("updated_at")
        _initialized = True


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def create_session() -> str:
    _ensure_schema()
    session_id = str(uuid.uuid4())
    now = _now_utc()
    state = OrchestratorState(
        session_id=session_id,
        phase="verification",
        profile=UserProfile(),
    )
    state_json = state.model_dump(mode="json")
    with _lock:
        _collection().insert_one(
            {
                "id": session_id,
                "state_json": state_json,
                "created_at": now,
                "updated_at": now,
            }
        )
    return session_id


def get_session(session_id: str) -> OrchestratorState | None:
    _ensure_schema()
    with _lock:
        row = _collection().find_one(
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
        _collection().update_one(
            {"id": session_id},
            {
                "$set": {
                    "state_json": state_json,
                    "updated_at": now,
                }
            },
        )


async def async_create_session() -> str:
    return await asyncio.to_thread(create_session)


async def async_get_session(session_id: str) -> OrchestratorState | None:
    return await asyncio.to_thread(get_session, session_id)


async def async_save_session(session_id: str, state: OrchestratorState) -> None:
    await asyncio.to_thread(save_session, session_id, state)
