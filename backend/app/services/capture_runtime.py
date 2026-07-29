"""Lazy singleton for the capture document-analysis agent."""

from __future__ import annotations

import asyncio
import os
import threading
from typing import Any

from langgraph.checkpoint.mongodb import MongoDBSaver
from langgraph.errors import GraphInterrupt
from langgraph.types import Command
from pymongo import MongoClient

from app.config import settings

_lock = threading.Lock()
_runtime: dict[str, Any] | None = None


def _ensure_env() -> None:
    if settings.mistral_api_key:
        os.environ.setdefault("MISTRAL_API_KEY", settings.mistral_api_key)
    os.environ.setdefault("MONGODB_URI", settings.mongo_uri)
    os.environ.setdefault("MONGODB_DB", settings.mongo_db_name)
    os.environ.setdefault("CHECKPOINT_DB", f"{settings.mongo_db_name}_checkpoints")


def get_runtime() -> dict[str, Any]:
    """Return {graph, deps, db} — initialized once per process."""
    global _runtime
    if _runtime is not None:
        return _runtime

    with _lock:
        if _runtime is not None:
            return _runtime

        _ensure_env()

        from app.agents.capture.app.config import get_settings
        from app.agents.capture.app.db import Database
        from app.agents.capture.app.graph import build_graph
        from app.agents.capture.app.mistral_client import MistralClient
        from app.agents.capture.app.nodes import Deps

        capture_settings = get_settings()
        if not capture_settings.mistral_api_key and settings.mistral_api_key:
            capture_settings.mistral_api_key = settings.mistral_api_key
        capture_settings.require_api_key()

        mongo: MongoClient = MongoClient(settings.mongo_uri)
        db = Database(mongo, settings.mongo_db_name)
        db.ensure_indexes()

        deps = Deps(mistral=MistralClient(capture_settings.mistral_api_key), db=db)
        checkpointer = MongoDBSaver(mongo, db_name=f"{settings.mongo_db_name}_checkpoints")
        graph = build_graph(deps, checkpointer)

        _runtime = {"graph": graph, "deps": deps, "db": db, "mongo": mongo}
        return _runtime


async def run_graph(graph, payload, config) -> None:
    try:
        await asyncio.to_thread(graph.invoke, payload, config)
    except GraphInterrupt:
        pass


async def resume_graph(graph, answer: str, config) -> None:
    try:
        await asyncio.to_thread(graph.invoke, Command(resume=answer), config)
    except GraphInterrupt:
        pass
