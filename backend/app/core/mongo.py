"""Shared MongoDB client for LedgerMind (users + orchestrator sessions)."""

from __future__ import annotations

import threading

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

from app.config import settings

_lock = threading.Lock()
_client: MongoClient | None = None


def get_client() -> MongoClient:
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                _client = MongoClient(settings.mongo_uri)
    return _client


def get_db() -> Database:
    return get_client()[settings.mongo_db_name]


def users_collection() -> Collection:
    return get_db()["users"]


def sessions_collection() -> Collection:
    return get_db()["sessions"]
