"""Shared Gemini client (JSON chat) for LedgerMind agents."""

from __future__ import annotations

import json
import logging
import re

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

_client = AsyncOpenAI(
    api_key=settings.gemini_api_key,
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
)

_SYSTEM = (
    "You are a JSON API. Reply with a single valid JSON object only. "
    "No markdown fences, no preamble, no explanation — first character must be '{'."
)


def _strip_json_fences(text: str) -> str:
    return text.replace("```json", "").replace("```", "").strip()


def _extract_json_object(text: str) -> dict:
    """Parse JSON even if the model adds a short preamble or fences."""
    cleaned = _strip_json_fences(text)
    try:
        data = json.loads(cleaned)
        if isinstance(data, dict):
            return data
    except (json.JSONDecodeError, TypeError):
        pass

    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if not match:
        raise json.JSONDecodeError("No JSON object found", cleaned, 0)
    data = json.loads(match.group(0))
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object, got {type(data)}")
    return data


async def chat_text(
    system: str,
    prompt: str,
    *,
    temperature: float = 0.2,
    max_tokens: int = 512,
    timeout: float = 30.0,
) -> str:
    """Réponse LIBRE (non JSON) avec consigne système — rédaction, reformulation.

    Utilisé par l'agent de guidance conversationnel, où le LLM ne fait que mettre en forme :
    aucun chiffre, aucune décision de régime ne sort d'ici.
    """
    response = await _client.chat.completions.create(
        model=settings.gemini_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=timeout,
    )
    return (response.choices[0].message.content or "").strip()


async def chat_json_with_system(
    system: str,
    prompt: str,
    *,
    temperature: float = 0.0,
    max_tokens: int = 512,
    timeout: float = 30.0,
) -> dict:
    """Comme `chat_json`, mais avec une consigne système dédiée (extraction structurée)."""
    response = await _client.chat.completions.create(
        model=settings.gemini_model,
        messages=[
            {"role": "system", "content": f"{system}\n\n{_SYSTEM}"},
            {"role": "user", "content": prompt},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=timeout,
        response_format={"type": "json_object"},
    )
    raw = response.choices[0].message.content or ""
    if not raw.strip():
        raise ValueError("Empty LLM response")
    return _extract_json_object(raw)


async def chat_json(
    prompt: str,
    *,
    temperature: float = 0.2,
    max_tokens: int = 1024,
    timeout: float = 30.0,
) -> dict:
    """Call Gemini and parse a JSON object response."""
    response = await _client.chat.completions.create(
        model=settings.gemini_model,
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": prompt},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=timeout,
        response_format={"type": "json_object"},
    )
    raw = response.choices[0].message.content or ""
    if not raw.strip():
        raise ValueError("Empty LLM response")
    try:
        return _extract_json_object(raw)
    except (json.JSONDecodeError, TypeError, ValueError) as e:
        logger.warning("LLM JSON parse failed: %s raw=%r", e, raw[:500])
        raise
