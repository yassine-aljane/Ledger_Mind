"""agent_context.guidance doit être peuplé pour un compte authentifié une fois la feuille de
route générée — sinon `hasCompletedOnboarding()` (frontend) ne peut jamais le détecter et renvoie
l'utilisateur au choix de branche à chaque reconnexion, alors que sa feuille de route existe bien.
"""

from __future__ import annotations

import mongomock
import pytest

from app.core import users as users_module


@pytest.fixture(autouse=True)
def mongo(monkeypatch):
    client = mongomock.MongoClient()
    db = client["ledgermind_test"]
    monkeypatch.setattr(users_module, "users_collection", lambda: db["users"])
    monkeypatch.setattr(users_module, "_initialized", False)
    db["users"].insert_one({"id": "u1", "email": "a@b.c", "agent_context": {}})
    yield db


def test_sync_guidance_snapshot_peuple_agent_context(mongo):
    users_module.sync_guidance_snapshot(
        "u1", session_id="s1", phase="done",
        profil={"activite": "contenu", "ca_estime": 36000.0},
        roadmap={"parcours": "micro"}, completeness=1.0,
    )
    doc = mongo["users"].find_one({"id": "u1"})
    guidance = doc["agent_context"]["guidance"]
    assert guidance["last_session_id"] == "s1"
    assert guidance["phase"] == "done"
    assert guidance["roadmap"] == {"parcours": "micro"}
    assert guidance["profile"]["activite"] == "contenu"


def test_sync_guidance_snapshot_sans_user_id_ne_fait_rien(mongo):
    users_module.sync_guidance_snapshot(
        "", session_id="s1", phase="done", profil={}, roadmap=None, completeness=0.0,
    )
    assert mongo["users"].find_one({"id": "u1"})["agent_context"] == {}
