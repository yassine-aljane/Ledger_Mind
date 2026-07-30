"""Backfill ponctuel : peuple agent_context.guidance pour les comptes dont la feuille de route
guidance existe déjà dans conversation_store mais n'a jamais été synchronisée (avant le fix —
voir sync_guidance_snapshot dans app/core/users.py). Idempotent : peut être relancé sans risque.

Usage (depuis backend/, venv actif) :
    python -m scripts.backfill_guidance_agent_context
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import conversation_store as store  # noqa: E402
from app.core.mongo import get_db  # noqa: E402
from app.core.users import sync_guidance_snapshot  # noqa: E402
from app.agents.guidance.conversation import questions_manquantes  # noqa: E402


def backfill() -> int:
    db = get_db()
    total = 0
    for user in db["users"].find({}, {"id": 1, "email": 1, "agent_context.guidance": 1}):
        uid = user["id"]
        deja = (user.get("agent_context") or {}).get("guidance") or {}
        if deja.get("last_session_id"):
            continue  # déjà synchronisé (par ce script ou par un tour de chat post-fix)

        profil = store.get_profil(uid)
        if not profil:
            continue
        conversations = store.list_sessions(uid, "guidance")
        if not conversations:
            continue
        session_id = conversations[0]["id"]
        etat = store.get_roadmap(session_id) or {}
        roadmap = etat.get("roadmap")

        sync_guidance_snapshot(
            uid, session_id=session_id,
            phase="done" if roadmap else "diagnostic_questions",
            profil=profil, roadmap=roadmap,
            completeness=1.0 if not questions_manquantes(profil) else 0.5,
        )
        total += 1
        print(f"[ok] {user.get('email')} — session {session_id}, roadmap={'oui' if roadmap else 'non'}")

    print(f"\n{total} compte(s) synchronisé(s).")
    return total


if __name__ == "__main__":
    backfill()
