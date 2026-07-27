"""SQLite-backed session store for orchestrator state."""

import asyncio
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.schemas.orchestrator import OrchestratorState, UserProfile

_lock = threading.Lock()
_initialized = False


def _db_path() -> Path:
    return Path(settings.session_db_path)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_db_path()), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_schema() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        path = _db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = _connect()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    state_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.commit()
        finally:
            conn.close()
        _initialized = True


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_session() -> str:
    _ensure_schema()
    session_id = str(uuid.uuid4())
    now = _now_iso()
    state = OrchestratorState(
        session_id=session_id,
        phase="verification",
        profile=UserProfile(),
    )
    state_json = state.model_dump_json()
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                "INSERT INTO sessions (id, state_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (session_id, state_json, now, now),
            )
            conn.commit()
        finally:
            conn.close()
    return session_id


def get_session(session_id: str) -> OrchestratorState | None:
    _ensure_schema()
    with _lock:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT state_json FROM sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
        finally:
            conn.close()
    if row is None:
        return None
    return OrchestratorState.model_validate_json(row["state_json"])


def save_session(session_id: str, state: OrchestratorState) -> None:
    _ensure_schema()
    now = _now_iso()
    state_json = state.model_dump_json()
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                "UPDATE sessions SET state_json = ?, updated_at = ? WHERE id = ?",
                (state_json, now, session_id),
            )
            conn.commit()
        finally:
            conn.close()


async def async_create_session() -> str:
    return await asyncio.to_thread(create_session)


async def async_get_session(session_id: str) -> OrchestratorState | None:
    return await asyncio.to_thread(get_session, session_id)


async def async_save_session(session_id: str, state: OrchestratorState) -> None:
    await asyncio.to_thread(save_session, session_id, state)
