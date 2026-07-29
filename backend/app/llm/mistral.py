"""Client Mistral — LLM et embeddings de l'espace guidance / assistant fiscal.

Porté du prototype `ranyaTra/LedgerMind`, où cette chaîne est éprouvée. Les agents
`guidance` et `pedagogue` ainsi que le corpus RAG passent par ici ; l'agent `intake`
(branche SIREN) garde son client Gemini — les deux fournisseurs coexistent sans se gêner.

Interface identique à `app.llm.gemini` (`chat_text`, `chat_json_with_system`) : le choix du
fournisseur est un détail d'infrastructure, invisible des agents.
"""

from __future__ import annotations

import json
import logging
import re

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

MISTRAL_BASE = "https://api.mistral.ai/v1"

_JSON_CONSIGNE = (
    "Réponds avec un unique objet JSON valide. Aucun texte autour, aucune balise de code : "
    "le premier caractère doit être '{'."
)


class MistralIndisponible(RuntimeError):
    """L'API Mistral n'a pas répondu (réseau, quota, clé absente)."""


def configure() -> bool:
    return bool(settings.mistral_api_key)


def _modele() -> str:
    """Nom de modèle accepté par l'API Mistral.

    Les .env existants portent parfois la notation LiteLLM `mistral/mistral-large-latest`,
    que l'API native rejette (« Invalid model »). On retire le préfixe de fournisseur plutôt
    que d'imposer une modification de fichier à chaque contributeur.
    """
    modele = (settings.mistral_model or "mistral-small-latest").strip()
    return modele.split("/", 1)[1] if modele.startswith("mistral/") else modele


def _headers() -> dict:
    if not settings.mistral_api_key:
        raise MistralIndisponible(
            "MISTRAL_API_KEY absente : l'espace guidance / assistant fiscal ne peut pas "
            "appeler le modèle."
        )
    return {"Authorization": f"Bearer {settings.mistral_api_key}"}


async def _completion(messages: list[dict], *, temperature: float, max_tokens: int,
                      json_mode: bool = False, timeout: float = 90.0) -> str:
    payload: dict = {
        "model": _modele(),
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            reponse = await client.post(f"{MISTRAL_BASE}/chat/completions",
                                        headers=_headers(), json=payload)
            reponse.raise_for_status()
            return reponse.json()["choices"][0]["message"]["content"] or ""
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:200] if exc.response is not None else ""
        raise MistralIndisponible(f"HTTP {exc.response.status_code} — {detail}") from exc
    except httpx.HTTPError as exc:
        raise MistralIndisponible(str(exc)) from exc


async def chat_text(system: str, prompt: str, *, temperature: float = 0.2,
                    max_tokens: int = 512, timeout: float = 90.0) -> str:
    """Réponse libre avec consigne système — rédaction, reformulation."""
    texte = await _completion(
        [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        temperature=temperature, max_tokens=max_tokens, timeout=timeout,
    )
    return texte.strip()


def _extraire_json(texte: str) -> dict:
    """Parse le JSON même si le modèle ajoute des balises ou une courte préface."""
    nettoye = texte.replace("```json", "").replace("```", "").strip()
    try:
        data = json.loads(nettoye)
        if isinstance(data, dict):
            return data
    except (json.JSONDecodeError, TypeError):
        pass
    trouve = re.search(r"\{.*\}", nettoye, flags=re.DOTALL)
    if not trouve:
        raise json.JSONDecodeError("Aucun objet JSON trouvé", nettoye, 0)
    data = json.loads(trouve.group(0))
    if not isinstance(data, dict):
        raise ValueError(f"Objet JSON attendu, reçu {type(data)}")
    return data


async def chat_json_with_system(system: str, prompt: str, *, temperature: float = 0.0,
                                max_tokens: int = 512, timeout: float = 90.0) -> dict:
    """Extraction structurée : renvoie un dictionnaire."""
    brut = await _completion(
        [{"role": "system", "content": f"{system}\n\n{_JSON_CONSIGNE}"},
         {"role": "user", "content": prompt}],
        temperature=temperature, max_tokens=max_tokens, json_mode=True, timeout=timeout,
    )
    if not brut.strip():
        raise MistralIndisponible("Réponse vide du modèle")
    return _extraire_json(brut)


async def embed(textes: list[str], *, is_query: bool = False,
                timeout: float = 60.0) -> list[list[float]]:
    """Vectorise des textes avec `mistral-embed`, par lots, dans l'ordre d'entrée.

    `is_query` est conservé pour la compatibilité avec le prototype (les modèles e5 locaux
    attendaient un préfixe) ; `mistral-embed` n'en a pas besoin.
    """
    if not textes:
        return []
    vecteurs: list[list[float]] = []
    for debut in range(0, len(textes), _LOT):
        lot = [t.replace("\n", " ").strip() or " " for t in textes[debut : debut + _LOT]]
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                reponse = await client.post(
                    f"{MISTRAL_BASE}/embeddings",
                    headers=_headers(),
                    json={"model": settings.embedding_model, "input": lot},
                )
                reponse.raise_for_status()
                vecteurs.extend(item["embedding"] for item in reponse.json()["data"])
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:200] if exc.response is not None else ""
            raise MistralIndisponible(
                f"Embeddings HTTP {exc.response.status_code} — {detail}") from exc
        except httpx.HTTPError as exc:
            raise MistralIndisponible(f"Embeddings : {exc}") from exc
    return vecteurs


# Taille de lot des embeddings : au-delà, l'API rejette la requête.
_LOT = 32
