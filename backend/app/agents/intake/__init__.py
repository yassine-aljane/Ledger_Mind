"""
Intake agent — SIRET verification + profile questions + tax/compliance.

Layout:
  agent.py       — public API
  questions.py   — LLM question phrasing (Gemini)
  understand.py  — LLM answer understanding (Gemini)
  llm.py         — shared Gemini client
  tools/         — LLM-free (verification, extract, classify_tax, check_compliance)
"""

from app.agents.intake.agent import (
    apply_verification_to_profile,
    ask_next_question,
    finalize_profile,
    handle_profile_answer,
    run_verification,
    skip_verification,
    verification_context,
)

__all__ = [
    "apply_verification_to_profile",
    "ask_next_question",
    "finalize_profile",
    "handle_profile_answer",
    "run_verification",
    "skip_verification",
    "verification_context",
]
