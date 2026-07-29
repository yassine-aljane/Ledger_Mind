"""Shared Gemini client (JSON chat) for LedgerMind agents."""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
from typing import Any

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


# Le palier gratuit Gemini limite le nombre d'appels par minute. Sans reprise, un simple
# dépassement fait échouer l'extraction du profil ET son interprétation : l'agent ne comprend
# plus la réponse de l'utilisateur et repose la même question indéfiniment.
#
# Mais ces appels servent une requête HTTP interactive : on ne peut pas faire patienter
# l'utilisateur une minute. La reprise est donc VOLONTAIREMENT courte — une seule, et seulement
# si l'API annonce un délai bref (creux passager). Quand elle réclame plus, le quota ne se
# rouvrira pas à l'échelle d'un tour de conversation : mieux vaut rendre la main tout de suite au
# repli déterministe, qui répond instantanément, que tenir la connexion ouverte pour rien.
#
# L'ingestion du corpus, elle, n'est pas interactive : `app.rag.embeddings` applique une politique
# plus patiente, adaptée à un script qui tourne en fond.
_MAX_TENTATIVES = 2
_ATTENTE_MAX = 6.0
_TRANSITOIRE = ("429", "resource_exhausted", "rate limit", "quota",
                "500", "502", "503", "504", "timeout", "timed out", "overloaded")


def _est_transitoire(exc: Exception) -> bool:
    return any(marqueur in str(exc).lower() for marqueur in _TRANSITOIRE)


def _delai_conseille(exc: Exception) -> float | None:
    """Délai que l'API demande d'attendre (`retryDelay: '23s'` / « retry in 23.6s »)."""
    message = str(exc)
    trouve = (re.search(r"retryDelay['\"]?:\s*['\"]?(\d+(?:\.\d+)?)s", message)
              or re.search(r"retry in (\d+(?:\.\d+)?)s", message, re.IGNORECASE))
    return float(trouve.group(1)) if trouve else None


async def _completion(**kwargs: Any):
    """Appel de complétion avec reprise sur quota et erreurs transitoires."""
    derniere: Exception | None = None
    for tentative in range(_MAX_TENTATIVES):
        try:
            return await _client.chat.completions.create(model=settings.gemini_model, **kwargs)
        except Exception as exc:  # noqa: BLE001 — repropagé si non transitoire ou à bout
            derniere = exc
            if not _est_transitoire(exc) or tentative == _MAX_TENTATIVES - 1:
                raise
            attente = _delai_conseille(exc) or 2.0
            if attente > _ATTENTE_MAX:
                # Quota durablement épuisé : inutile de faire attendre l'utilisateur.
                logger.warning("Gemini demande %.0fs d'attente — abandon, repli déterministe.",
                               attente)
                raise
            logger.info("Gemini indisponible (%s) — reprise dans %.1fs",
                        type(exc).__name__, attente)
            await asyncio.sleep(attente + random.uniform(0, 0.5))
    raise derniere  # type: ignore[misc]


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
    response = await _completion(
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
    response = await _completion(
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
    response = await _completion(
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
