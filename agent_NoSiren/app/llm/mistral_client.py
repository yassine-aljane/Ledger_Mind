"""Client LLM : chat via l'API Mistral, embeddings via modèle local (gratuit) ou API Mistral."""
from __future__ import annotations

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import settings

MISTRAL_BASE = "https://api.mistral.ai/v1"

# Chargement paresseux du modèle d'embedding local (évite le coût au démarrage si non utilisé)
_local_model = None


def _get_local_model():
    global _local_model
    if _local_model is None:
        from sentence_transformers import SentenceTransformer

        _local_model = SentenceTransformer(settings.local_embedding_model)
    return _local_model


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8))
async def chat(
    messages: list[dict],
    temperature: float = 0.2,
    max_tokens: int = 1200,
    json_mode: bool = False,
) -> str:
    """Appelle l'endpoint chat de Mistral et renvoie le texte de la réponse."""
    payload = {
        "model": settings.mistral_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    async with httpx.AsyncClient(timeout=90) as client:
        r = await client.post(
            f"{MISTRAL_BASE}/chat/completions",
            headers={"Authorization": f"Bearer {settings.mistral_api_key}"},
            json=payload,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


def embed(texts: list[str], is_query: bool = False) -> list[list[float]]:
    """Renvoie les embeddings. Local par défaut (gratuit), sinon API Mistral."""
    if settings.embeddings_provider == "mistral":
        return _embed_mistral(texts)

    model = _get_local_model()
    # Les modèles e5 attendent un préfixe "query:" / "passage:"
    prefix = "query: " if is_query else "passage: "
    prepared = [prefix + t for t in texts]
    return model.encode(prepared, normalize_embeddings=True).tolist()


def _embed_mistral(texts: list[str]) -> list[list[float]]:
    with httpx.Client(timeout=60) as client:
        r = client.post(
            f"{MISTRAL_BASE}/embeddings",
            headers={"Authorization": f"Bearer {settings.mistral_api_key}"},
            json={"model": "mistral-embed", "input": texts},
        )
        r.raise_for_status()
        return [d["embedding"] for d in r.json()["data"]]
